import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { clients, createDatabase, customerQuotes, engagementAcceptances, engagementTerms, jobs, organisationMemberships, organisations, properties, users, withTenant, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { jobEngagement, practiceTerms, publicEngagement, publishTerms, recordPracticeSignature, saveTermsDraft, setTermsRequired, signPublicEngagement, termsBlockBooking, termsDigest } from "../src/lib/engagement-terms";

describe.skipIf(!integrationEnabled)("terms of engagement", () => {
  let database: TestDatabase, db: Database;
  let org = "", jobId = "", otherJob = "", quoteId = "";
  const token = "case-token-for-terms-test";
  let manager: { organisationId: string; internalUserId: string; role: "manager" };
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [o] = await db.insert(organisations).values({ clerkOrganisationId: "org_terms", slug: "terms", name: "Terms practice", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    org = o.id;
    const [person] = await db.insert(users).values({ clerkUserId: "u_terms", email: "m@terms.test" }).returning();
    await db.insert(organisationMemberships).values({ organisationId: org, userId: person.id, role: "manager" });
    manager = { organisationId: org, internalUserId: person.id, role: "manager" };
    const [client] = await db.insert(clients).values({ organisationId: org, kind: "individual", displayName: "Fictional Client" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: org, clientId: client.id, line1: "2 Terms Road", city: "Bristol", postcode: "BS2 2ZZ", country: "ENG" }).returning();
    const created = await db.insert(jobs).values([{ organisationId: org, clientId: client.id, propertyId: property.id, reference: "T-1", serviceName: "Level 2", stage: "instructed" }, { organisationId: org, clientId: client.id, propertyId: property.id, reference: "T-2", serviceName: "Level 2", stage: "instructed" }]).returning();
    jobId = created[0].id; otherJob = created[1].id; quoteId = randomUUID();
    await db.insert(customerQuotes).values({ id: quoteId, organisationId: org, reference: "Q-T1", status: "converted", clientId: client.id, propertyId: property.id, jobId, subtotalMinor: 100, vatMinor: 20, totalMinor: 120, depositMinor: 12, accessTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000), pricingSnapshot: { service: "Level 2" } });
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  const wording = "1. The service. We will inspect what is visible and accessible on the day and report on it.";
  it("keeps one draft, publishes it as a frozen version and refuses to require signatures before publishing", async () => {
    await expect(setTermsRequired(manager, true)).rejects.toMatchObject({ code: "terms_not_published" });
    const draft = await saveTermsDraft(manager, { title: "Residential terms", body: wording });
    const again = await saveTermsDraft(manager, { title: "Residential terms", body: `${wording} Updated.` });
    expect(again.id).toBe(draft.id);
    const published = await publishTerms(manager, draft.id);
    expect(published).toMatchObject({ status: "published", version: 1 });
    await expect(db.update(engagementTerms).set({ body: "Rewritten after publishing to change what was agreed." }).where(eq(engagementTerms.id, draft.id))).rejects.toThrow();
    const next = await saveTermsDraft(manager, { title: "Residential terms", body: `${wording} Version two.` });
    expect(next.version).toBe(2);
    await setTermsRequired(manager, true);
    expect((await practiceTerms(manager)).required).toBe(true);
  });
  it("blocks booking until the client signs the current version, and records the exact wording's hash", async () => {
    expect(await withTenant(createDatabase(), org, (tx) => termsBlockBooking(tx, org, jobId))).toBe(true);
    const shown = await publicEngagement(quoteId, token);
    expect(shown?.terms?.version).toBe(1);
    expect(await publicEngagement(quoteId, "wrong-token")).toBeNull();
    await expect(signPublicEngagement(quoteId, token, { termsId: randomUUID(), signerName: "Jo Client", agree: true }, { ip: null, userAgent: null })).rejects.toMatchObject({ code: "terms_changed" });
    const signed = await signPublicEngagement(quoteId, token, { termsId: shown!.terms!.id, signerName: "Jo Client", signerEmail: "jo@example.test", agree: true }, { ip: "203.0.113.9", userAgent: "Test browser" });
    expect(signed).toMatchObject({ signerName: "Jo Client", version: 1, method: "typed_signature" });
    const [row] = await db.select().from(engagementAcceptances).where(eq(engagementAcceptances.jobId, jobId));
    expect(row.termsSha256).toBe(termsDigest(shown!.terms!.title, shown!.terms!.body));
    expect(row.ipHash).not.toContain("203.0.113.9");
    expect(await withTenant(createDatabase(), org, (tx) => termsBlockBooking(tx, org, jobId))).toBe(false);
    await expect(db.execute(sql`update engagement_acceptances set signer_name = 'Someone else' where id = ${row.id}`)).rejects.toThrow();
  });
  it("re-requires a signature when a new version is published, and lets the practice record a paper signature", async () => {
    const terms = await practiceTerms(manager);
    await publishTerms(manager, terms.versions.find((item) => item.status === "draft")!.id);
    expect(await withTenant(createDatabase(), org, (tx) => termsBlockBooking(tx, org, jobId))).toBe(true);
    expect((await jobEngagement(manager, jobId))?.acceptance?.version).toBe(1);
    const paper = await recordPracticeSignature(manager, otherJob, { signerName: "Sam Paper", signedOn: "2026-10-01", confirm: true });
    expect(paper).toMatchObject({ method: "recorded_by_practice", version: 2 });
    await expect(recordPracticeSignature(manager, otherJob, { signerName: "Sam Paper", signedOn: "2026-10-01", confirm: true })).rejects.toMatchObject({ code: "already_signed" });
    await expect(recordPracticeSignature({ ...manager, role: "surveyor" as never }, otherJob, { signerName: "X", signedOn: "2026-10-01", confirm: true })).rejects.toMatchObject({ status: 403 });
  });
});
