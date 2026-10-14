import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { backgroundJobs, clientPortalAccess, clients, createDatabase, customerQuotes, invoiceLineItems, invoices, jobStageEvents, jobs, mediaAssets, organisationMemberships, organisationOperationalSettings, organisations, properties, users, withTenant, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { createPortalLink, inviteAfterQuoteConversion, portalAdmin, portalDocument, portalView, resolvePortal, revokePortal, sendPortalLink, shareFile, unshareFile } from "../src/lib/client-portal";
import { createSurvey } from "../src/lib/surveys";

describe.skipIf(!integrationEnabled)("client portal", () => {
  let database: TestDatabase, db: Database;
  let org = "", jobId = "", otherJob = "", quoteId = "", mediaId = "", otherMedia = "", invoiceId = "";
  const quoteToken = "portal-quote-token";
  type Ctx = { organisationId: string; internalUserId: string; role: "manager" | "surveyor" };
  let manager: Ctx, surveyor: Ctx;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl); vi.stubEnv("APP_URL", "https://portal.example.test");
    const [o] = await db.insert(organisations).values({ clerkOrganisationId: "org_portal", slug: "portal", name: "Portal Surveyors", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    org = o.id;
    await db.insert(organisationOperationalSettings).values({ organisationId: org, customerBranding: { displayName: "Portal Surveyors LLP", accentColour: "#0f766e", logoUrl: "http://insecure.example/logo.png" }, reportIdentity: { email: "hello@portal.test" } });
    const people = await db.insert(users).values([{ clerkUserId: "u_portal_m", email: "m@portal.test" }, { clerkUserId: "u_portal_s", email: "s@portal.test" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org, userId: people[0].id, role: "manager" }, { organisationId: org, userId: people[1].id, role: "surveyor" }]);
    manager = { organisationId: org, internalUserId: people[0].id, role: "manager" }; surveyor = { organisationId: org, internalUserId: people[1].id, role: "surveyor" };
    const [client] = await db.insert(clients).values({ organisationId: org, kind: "individual", displayName: "Robin Client", email: "Robin@Example.test" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: org, clientId: client.id, line1: "9 Portal Road", city: "Bristol", postcode: "BS9 9ZZ", country: "ENG", propertyType: "Detached house" }).returning();
    const created = await db.insert(jobs).values([{ organisationId: org, clientId: client.id, propertyId: property.id, reference: "P-1", serviceName: "Level 2 Home Survey", stage: "scheduled", assignedSurveyorId: people[1].id }, { organisationId: org, clientId: client.id, propertyId: property.id, reference: "P-2", serviceName: "Level 3", stage: "instructed" }]).returning();
    jobId = created[0].id; otherJob = created[1].id; quoteId = randomUUID();
    await db.insert(jobStageEvents).values([{ organisationId: org, jobId, fromStage: "quoted", toStage: "instructed", createdAt: new Date(Date.now() - 5 * 86_400_000) }, { organisationId: org, jobId, fromStage: "instructed", toStage: "scheduled", createdAt: new Date(Date.now() - 2 * 86_400_000) }]);
    await db.insert(customerQuotes).values({ id: quoteId, organisationId: org, reference: "Q-P1", status: "converted", clientId: client.id, propertyId: property.id, jobId, subtotalMinor: 50000, vatMinor: 10000, totalMinor: 60000, depositMinor: 10000, accessTokenHash: createHash("sha256").update(quoteToken).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000), pricingSnapshot: { service: "Level 2 Home Survey" } });
    const [invoice] = await db.insert(invoices).values({ organisationId: org, jobId, quoteId, number: "INV-P1", status: "open", subtotalMinor: 50000, vatMinor: 10000, totalMinor: 60000, issuedAt: new Date() }).returning();
    invoiceId = invoice.id;
    await db.insert(invoiceLineItems).values({ organisationId: org, invoiceId, description: "Level 2 Home Survey", unitAmountMinor: 50000 });
    await db.insert(invoices).values({ organisationId: org, jobId, number: "INV-DRAFT", status: "draft", subtotalMinor: 1, vatMinor: 0, totalMinor: 1 });
    const survey = await createSurvey({ ...surveyor, canRecordSurvey: true }, jobId, { serviceLevel: "level_2" });
    const otherSurvey = await createSurvey({ ...manager, role: "manager", canRecordSurvey: true }, otherJob, { serviceLevel: "level_2" }).catch(() => null);
    if (survey.kind !== "created") throw new Error(survey.kind);
    const media = await db.insert(mediaAssets).values([
      { organisationId: org, propertyId: property.id, surveyId: survey.survey.id, kind: "photo", storageKey: "k/1", contentType: "image/jpeg", byteSize: 10, sha256: "a", clientGeneratedId: "media_portal_1" },
      ...(otherSurvey && otherSurvey.kind === "created" ? [{ organisationId: org, propertyId: property.id, surveyId: otherSurvey.survey.id, kind: "photo" as const, storageKey: "k/2", contentType: "image/jpeg", byteSize: 10, sha256: "b", clientGeneratedId: "media_portal_2" }] : []),
    ]).returning();
    mediaId = media[0].id; otherMedia = media[1]?.id ?? randomUUID();
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("emails a portal link to the client's address and replaces it on resend", async () => {
    await expect(sendPortalLink(surveyor, jobId)).rejects.toMatchObject({ status: 403 });
    const first = await sendPortalLink(manager, jobId);
    expect(first.sentTo).toBe("robin@example.test");
    const [queued] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.type, "client_portal_invite"));
    const url = String(queued.payload.portalUrl);
    expect(url).toMatch(/^https:\/\/portal\.example\.test\/portal\/[0-9a-f-]{36}#/);
    const [accessId, token] = url.split("/portal/")[1].split("#");
    expect(await resolvePortal({ via: "portal", id: accessId, token })).toMatchObject({ jobId });
    expect(await resolvePortal({ via: "portal", id: accessId, token: `${token}x` })).toBeNull();
    const copied = await createPortalLink(manager, jobId);
    expect(await resolvePortal({ via: "portal", id: accessId, token })).toBeNull();
    const [copiedId, copiedToken] = copied.url.split("/portal/")[1].split("#");
    expect(await resolvePortal({ via: "portal", id: copiedId, token: copiedToken })).toMatchObject({ jobId });
    expect((await portalAdmin(manager, jobId))?.access).toMatchObject({ source: "practice_link" });
    await revokePortal(manager, jobId);
    expect(await resolvePortal({ via: "portal", id: copiedId, token: copiedToken })).toBeNull();
  });
  it("shows branded progress, documents, invoices and only explicitly shared files", async () => {
    const credential = { via: "quote" as const, id: quoteId, token: quoteToken };
    await expect(shareFile(manager, jobId, { mediaAssetId: otherMedia, category: "photo", title: "Not this job" })).rejects.toMatchObject({ status: 404 });
    const shared = await shareFile(manager, jobId, { mediaAssetId: mediaId, category: "photo", title: "Front elevation" });
    await expect(shareFile(manager, jobId, { mediaAssetId: mediaId, category: "photo", title: "Again" })).rejects.toMatchObject({ code: "already_shared" });
    const view = await portalView(credential);
    expect(view.brand).toMatchObject({ name: "Portal Surveyors LLP", accent: "#0f766e", logoUrl: null, email: "hello@portal.test" });
    expect(view.property).toMatchObject({ address: "9 Portal Road, Bristol, BS9 9ZZ", propertyType: "Detached house" });
    expect(view.progress.find((step) => step.stage === "scheduled")).toMatchObject({ state: "current" });
    expect(view.progress.find((step) => step.stage === "instructed")?.reachedAt).not.toBeNull();
    expect(view.invoices.map((invoice) => invoice.number)).toEqual(["INV-P1"]);
    expect(view.files).toEqual([expect.objectContaining({ id: shared.id, title: "Front elevation", category: "photo" })]);
    expect(view.documents.find((doc) => doc.key === "rics_report")).toMatchObject({ available: false, reason: "Available once the report is issued." });
    expect(view.documents.find((doc) => doc.key === "quote")?.available).toBe(true);
    await unshareFile(manager, jobId, shared.id);
    expect((await portalView(credential)).files).toEqual([]);
  });
  it("produces the quote and invoice PDFs, and refuses unissued reports and other jobs' invoices", async () => {
    const credential = { via: "quote" as const, id: quoteId, token: quoteToken };
    const invoice = await portalDocument(credential, `invoice:${invoiceId}`);
    expect((await PDFDocument.load(invoice.bytes)).getTitle()).toBe("Invoice INV-P1");
    expect((await portalDocument(credential, "quote")).filename).toBe("quote-Q-P1.pdf");
    await expect(portalDocument(credential, "rics_report")).rejects.toMatchObject({ status: 409 });
    await expect(portalDocument(credential, "signed_terms")).rejects.toMatchObject({ status: 404 });
    await expect(portalDocument(credential, `invoice:${randomUUID()}`)).rejects.toMatchObject({ status: 404 });
  });
  it("issues a portal invite in the same transaction as a quote conversion", async () => {
    const accessId = await withTenant(createDatabase(database.adminUrl), org, (tx) => inviteAfterQuoteConversion(tx, { organisationId: org, jobId: otherJob, email: "Robin@Example.test", clientName: "Robin Client", propertyAddress: "9 Portal Road", reference: "P-2" }));
    const [access] = await db.select().from(clientPortalAccess).where(eq(clientPortalAccess.id, accessId!));
    expect(access).toMatchObject({ source: "quote_accepted", email: "robin@example.test", revokedAt: null });
    const invites = await db.select().from(backgroundJobs).where(eq(backgroundJobs.deduplicationKey, `portal-invite:${accessId}`));
    expect(invites).toHaveLength(1);
    expect(await withTenant(createDatabase(database.adminUrl), org, (tx) => inviteAfterQuoteConversion(tx, { organisationId: org, jobId: otherJob, email: null, clientName: "Robin", propertyAddress: "x", reference: "P-2" }))).toBeNull();
  });
});
