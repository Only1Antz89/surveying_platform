import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { clients, customerQuotes, jobs, organisationMemberships, organisationOperationalSettings, organisations, properties, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { jobLetterPdf, practiceQuotePdf, practiceReportPdf, practiceSignedTermsPdf, publicQuotePdf } from "../src/lib/practice-documents";
import { createSurvey } from "../src/lib/surveys";
import { composeSurveyReport } from "../src/lib/reports";

describe.skipIf(!integrationEnabled)("practice-branded documents", () => {
  let database: TestDatabase, db: Database;
  let org = "", otherOrg = "", jobId = "", quoteId = "", surveyId = "";
  let manager: { organisationId: string; internalUserId: string; role: "manager" }, surveyor: { organisationId: string; internalUserId: string; role: "surveyor"; canRecordSurvey: boolean }, outsider: typeof surveyor;
  const token = "documents-case-token";
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [o, o2] = await db.insert(organisations).values([{ clerkOrganisationId: "org_docs", slug: "docs", name: "Docs practice", practiceType: "building_surveying", region: "Bristol", status: "active" }, { clerkOrganisationId: "org_docs2", slug: "docs2", name: "Other", practiceType: "building_surveying", region: "Bath", status: "active" }]).returning();
    org = o.id; otherOrg = o2.id;
    await db.insert(organisationOperationalSettings).values({ organisationId: org, reportIdentity: { companyName: "Docs Surveyors LLP", address: "3 Doc Lane", email: "hello@docs.test" }, customerBranding: { accentColour: "#0f766e" } });
    const people = await db.insert(users).values([{ clerkUserId: "u_docs_m", email: "m@docs.test" }, { clerkUserId: "u_docs_s", email: "s@docs.test" }, { clerkUserId: "u_docs_o", email: "o@docs.test" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org, userId: people[0].id, role: "manager" }, { organisationId: org, userId: people[1].id, role: "surveyor", canRecordSurvey: true }, { organisationId: org, userId: people[2].id, role: "surveyor", canRecordSurvey: true }]);
    manager = { organisationId: org, internalUserId: people[0].id, role: "manager" };
    surveyor = { organisationId: org, internalUserId: people[1].id, role: "surveyor", canRecordSurvey: true };
    outsider = { organisationId: org, internalUserId: people[2].id, role: "surveyor", canRecordSurvey: true };
    const [client] = await db.insert(clients).values({ organisationId: org, kind: "individual", displayName: "Fictional Client" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: org, clientId: client.id, line1: "4 Document Row", city: "Bristol", postcode: "BS4 4ZZ", country: "ENG" }).returning();
    const [job] = await db.insert(jobs).values({ organisationId: org, clientId: client.id, propertyId: property.id, reference: "D-1", serviceName: "Level 2", stage: "report_drafting", assignedSurveyorId: people[1].id }).returning();
    jobId = job.id; quoteId = randomUUID();
    await db.insert(customerQuotes).values({ id: quoteId, organisationId: org, reference: "Q-D1", status: "issued", firstName: "Fictional", lastName: "Client", propertyAddress: "4 Document Row", city: "Bristol", postcode: "BS4 4ZZ", subtotalMinor: 50000, vatMinor: 10000, totalMinor: 60000, depositMinor: 10000, accessTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000), pricingSnapshot: { service: "Level 2 Home Survey" } });
    const created = await createSurvey(surveyor, jobId, { serviceLevel: "level_2" });
    if (created.kind !== "created") throw new Error(created.kind);
    surveyId = created.survey.id;
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("produces the quote for the practice and the client, never for another practice or a wrong link", async () => {
    const practice = await practiceQuotePdf(manager, quoteId);
    const loaded = await PDFDocument.load(practice!.bytes);
    expect(loaded.getAuthor()).toBe("Docs Surveyors LLP");
    expect(practice!.filename).toBe("quote-Q-D1.pdf");
    expect(await practiceQuotePdf({ ...manager, organisationId: otherOrg }, quoteId)).toBeNull();
    expect((await publicQuotePdf(quoteId, token))?.filename).toBe("quote-Q-D1.pdf");
    expect(await publicQuotePdf(quoteId, "wrong")).toBeNull();
  });
  it("scopes letters and signed terms to the viewer's work", async () => {
    expect((await jobLetterPdf(surveyor, jobId, { subject: "Access", body: "Please leave the loft hatch clear.", recipient: "client" }))?.filename).toBe("letter-D-1.pdf");
    expect(await jobLetterPdf(outsider, jobId, { subject: "Access", body: "Please leave the loft hatch clear.", recipient: "client" })).toBeNull();
    expect(await practiceSignedTermsPdf(manager, jobId)).toBeNull();
  });
  it("watermarks a practice report until a current version is signed off", async () => {
    expect(await practiceReportPdf(surveyor, surveyId)).toBeNull();
    await composeSurveyReport(surveyor, surveyId);
    const draft = await practiceReportPdf(surveyor, surveyId);
    expect(draft!.filename).toBe("D-1-v1-review.pdf");
    expect(await practiceReportPdf(outsider, surveyId)).toBeNull();
  });
});
