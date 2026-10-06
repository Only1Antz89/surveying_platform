import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clients, customerQuotes, jobs, organisationMemberships, organisationOperationalSettings, organisations, preinspectionDocuments, preinspectionDrafts, preinspectionLinks, preinspectionSubmissions, properties, users, withTenant } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { issuePreinspectionLink, publicPreinspection, readPreinspection, revokePreinspectionLinks, staffPreinspection, writePreinspection } from "../src/lib/preinspection";
import { createSurvey, upgradeHomeSurveyTemplate } from "../src/lib/surveys";
import { refreshSurveyProposals, listSurveyProposals, reviewProposal } from "../src/lib/proposals";
import { homeSurveyTemplatesV1_1 } from "@surveynt/assistant";
import { makeTextPdf, makeImageOnlyPdf } from "@surveynt/evidence/testing";
import { createMemoryStorage, setObjectStorageForTests } from "../src/lib/storage";
import { confirmDocumentWorks, downloadPreinspectionDocument, listPreinspectionDocuments, uploadPreinspectionDocument } from "../src/lib/preinspection-documents";
import { seedDemoEvidence } from "../src/lib/demo-evidence";
import { seedDemoEvidenceDocuments } from "../src/lib/demo-evidence-documents";

describe.skipIf(!integrationEnabled)("private preinspection evidence", () => {
  let database: TestDatabase;
  const org = crypto.randomUUID(), otherOrg = crypto.randomUUID(), owner = crypto.randomUUID(), surveyor = crypto.randomUUID(), unassigned = crypto.randomUUID();
  const client = crypto.randomUUID(), property = crypto.randomUUID(), job = crypto.randomUUID(), quote = crypto.randomUUID();
  const parentToken = "test-private-quote-token";
  const staff = { organisationId: org, internalUserId: surveyor, role: "surveyor" as const };
  let token = "", submissionId = "", surveyId = "";
  const storage = createMemoryStorage();
  const upload = (bytes: Uint8Array, requestId = crypto.randomUUID(), replacesId?: string) => {
    const form = new FormData(); form.set("file", new File([new Uint8Array(bytes)], "fictional-certificate.pdf", { type: "application/pdf" })); form.set("requestId", requestId); if (replacesId) form.set("replacesId", replacesId);
    return new Request("http://localhost/documents", { method: "POST", body: form });
  };
  const scope = <T>(work: Parameters<typeof publicPreinspection<T>>[3]) => publicPreinspection(quote, parentToken, token, work);
  beforeAll(async () => {
    setObjectStorageForTests(storage);
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, ASSISTANT_ENABLED: "true" });
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values([org, otherOrg].map(id => ({ id, clerkOrganisationId: `test-${id}`, slug: `test-${id}`, name: "Fictional questionnaire practice", practiceType: "residential", region: "England", status: "active" as const, isDemo: true })));
    await admin.insert(users).values([owner, surveyor, unassigned].map(id => ({ id, clerkUserId: `test-${id}`, email: `${id}@example.test` })));
    await admin.insert(organisationMemberships).values([{ organisationId: org, userId: owner, role: "owner" }, { organisationId: org, userId: surveyor, role: "surveyor" }, { organisationId: org, userId: unassigned, role: "surveyor" }]);
    await admin.insert(organisationOperationalSettings).values({ organisationId: org, surveyEvidenceEnabled: true });
    await admin.insert(clients).values({ id: client, organisationId: org, kind: "individual", displayName: "Fictional customer" });
    await admin.insert(properties).values({ id: property, organisationId: org, clientId: client, line1: "1 Fictional Road", city: "Bristol", postcode: "BS1 1AA", country: "ENG" });
    await admin.insert(jobs).values({ id: job, organisationId: org, clientId: client, propertyId: property, reference: "QUESTIONNAIRE-1", serviceName: "Level 2 survey", assignedSurveyorId: surveyor });
    await admin.insert(customerQuotes).values({ id: quote, organisationId: org, reference: "QUOTE-1", status: "converted", clientId: client, propertyId: property, jobId: job, subtotalMinor: 100, vatMinor: 20, totalMinor: 120, depositMinor: 12, accessTokenHash: createHash("sha256").update(parentToken).digest("hex"), expiresAt: new Date(Date.now() - 86_400_000), pricingSnapshot: { service: "Level 2" } });
    token = (await publicPreinspection(quote, parentToken, null, (tx, scope) => issuePreinspectionLink(tx, scope, quote))).token;
  }, 120_000);
  afterAll(async () => { setObjectStorageForTests(null); await database?.drop(); await stopRelay(); });

  it("uses purpose scope, rejects wrong parent/scoped tokens and never exposes staff observations", async () => {
    const view = await scope(readPreinspection);
    expect(view.draft).toEqual({ version: 0, answers: {} });
    expect(view).not.toHaveProperty("observations");
    await expect(publicPreinspection(quote, "wrong", token, readPreinspection)).rejects.toMatchObject({ status: 404 });
    await expect(publicPreinspection(quote, parentToken, "", readPreinspection)).rejects.toMatchObject({ status: 404 });
    await expect(publicPreinspection(quote, parentToken, "x".repeat(43), readPreinspection)).rejects.toMatchObject({ status: 404 });
  });
  it("persists drafts but only submits immutable evidence, supports corrections and idempotent submissions", async () => {
    const draft = await scope((tx, scope) => writePreinspection(tx, scope, { version: 0, requestId: crypto.randomUUID(), answers: { concerns: "Damp concern", propertyType: "House" } }, false));
    expect(draft.submission).toBeNull(); expect(draft.draft.version).toBe(1);
    const input = { version: 1, requestId: crypto.randomUUID(), answers: draft.draft.answers };
    const submitted = await scope((tx, scope) => writePreinspection(tx, scope, input, true));
    submissionId = submitted.submission.id;
    expect(submitted.submission.version).toBe(2);
    expect((await scope((tx, scope) => writePreinspection(tx, scope, input, true))).history).toHaveLength(1);
    await expect(scope((tx, scope) => writePreinspection(tx, scope, { ...input, answers: { concerns: "Changed" } }, true))).rejects.toMatchObject({ status: 409 });
    const corrected = await scope((tx, scope) => writePreinspection(tx, scope, { version: 2, requestId: crypto.randomUUID(), answers: { concerns: "Revised concern", propertyType: "House" } }, true));
    expect(corrected.history).toHaveLength(2);
    expect(corrected.history[1].answers.concerns).toBe("Damp concern");
    await expect(scope((tx, scope) => writePreinspection(tx, scope, { version: 2, requestId: crypto.randomUUID(), answers: {} }, false))).rejects.toMatchObject({ code: "questionnaire_changed" });
    await expect(scope((tx, scope) => writePreinspection(tx, scope, { version: 3, requestId: crypto.randomUUID(), answers: { agreedPurchasePriceMinor: 50000000 } }, false))).rejects.toMatchObject({ code: "valuation_only" });
  });
  it("enforces assigned jobs, active membership, cross-tenant RLS and immutable submitted records", async () => {
    expect((await staffPreinspection(staff, job, readPreinspection)).submission.answers.concerns).toBe("Revised concern");
    await expect(staffPreinspection({ ...staff, internalUserId: unassigned }, job, readPreinspection)).rejects.toMatchObject({ status: 404 });
    const app = database.connect(database.appUrl);
    expect(await withTenant(app, otherOrg, tx => tx.select().from(preinspectionSubmissions))).toHaveLength(0);
    await expect(withTenant(app, otherOrg, tx => tx.insert(preinspectionDrafts).values({ organisationId: org, jobId: job, propertyId: property }))).rejects.toThrow();
    await expect(withTenant(app, org, tx => tx.update(preinspectionSubmissions).set({ answers: {} }).where(eq(preinspectionSubmissions.id, submissionId)))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } });
    await expect(withTenant(app, org, tx => tx.delete(preinspectionSubmissions).where(eq(preinspectionSubmissions.id, submissionId)))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } });
  });
  it("requires explicit professional upgrade and rejects stale revised customer evidence", async () => {
    const template = homeSurveyTemplatesV1_1[1];
    const created = await createSurvey(staff, job, { serviceLevel: "level_2", templateKey: template.key, templateVersion: template.version });
    if (created.kind !== "created") throw new Error(created.kind);
    surveyId = created.survey.id;
    expect(await upgradeHomeSurveyTemplate({ organisationId: org, internalUserId: owner, role: "owner" }, surveyId, created.survey.version)).toMatchObject({ kind: "denied" });
    expect(await upgradeHomeSurveyTemplate(staff, surveyId, created.survey.version)).toMatchObject({ kind: "upgraded", version: "1.2.0" });
    expect((await refreshSurveyProposals(staff, surveyId)).created).toBeGreaterThan(0);
    const proposal = (await listSurveyProposals(staff, surveyId)).find(p => p.fieldPath === "a.details.client_brief" && p.reviewStatus === "pending")!;
    expect(proposal.originClass).toBe("customer_statement");
    await scope((tx, scope) => writePreinspection(tx, scope, { version: 3, requestId: crypto.randomUUID(), answers: { concerns: "Further correction", propertyType: "House" } }, true));
    expect(await reviewProposal(staff, surveyId, proposal.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ kind: "conflict" });
    await refreshSurveyProposals(staff, surveyId);
    const current = (await listSurveyProposals(staff, surveyId)).find(p => p.fieldPath === "a.details.client_brief" && p.reviewStatus === "pending")!;
    expect(await reviewProposal(staff, surveyId, current.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ kind: "reviewed" });
  });
  it("stores private originals idempotently and rejects unassigned document access", async () => {
    const bytes = makeTextPdf([["Building regulations completion certificate", "Date of issue: 01/01/2021", "Certificate number: DEMO-2021-001"]]); const requestId = crypto.randomUUID();
    const first = await scope((tx, scope) => uploadPreinspectionDocument(tx, scope, upload(bytes, requestId), { key: null }));
    expect(await scope((tx, scope) => uploadPreinspectionDocument(tx, scope, upload(bytes, requestId), { key: null }))).toMatchObject({ id: first.id, duplicate: true });
    expect(storage.objects.size).toBe(1);
    expect(await withTenant(database.connect(database.appUrl), otherOrg, tx => tx.select().from(preinspectionDocuments))).toHaveLength(0);
    const download = await scope((tx, scope) => downloadPreinspectionDocument(tx, scope, first.id));
    expect(download.headers.get("content-disposition")).toContain("attachment"); expect(download.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    await expect(staffPreinspection({ ...staff, internalUserId: unassigned }, job, (tx, scope) => downloadPreinspectionDocument(tx, scope, first.id))).rejects.toMatchObject({ status: 404 });
    await refreshSurveyProposals(staff, surveyId);
    expect((await listSurveyProposals(staff, surveyId)).some(proposal => proposal.fieldPath === "c.details.extended_year" && proposal.reviewStatus === "pending")).toBe(false);
  });
  it("requires explicit works association and rejects proposals after private-document replacement", async () => {
    const bytes = makeTextPdf([["Building regulations completion certificate", "Date of issue: 01/01/2021", "Works completion date: 15/06/2020", "Certificate number: DEMO-2020-001"]]);
    const uploaded = await scope((tx, scope) => uploadPreinspectionDocument(tx, scope, upload(bytes), { key: null }));
    const document = (await scope(listPreinspectionDocuments)).find(row => row.id === uploaded.id)!;
    const input = { worksKind: "extension", checksum: document.checksum, reason: "Reviewed original against the fictional property and extension drawings", confirm: true };
    await expect(staffPreinspection({ organisationId: org, internalUserId: owner, role: "owner" }, job, (tx, scope) => confirmDocumentWorks(tx, scope, { organisationId: org, internalUserId: owner, role: "owner" }, uploaded.id, input))).rejects.toMatchObject({ status: 403 });
    await staffPreinspection(staff, job, (tx, scope) => confirmDocumentWorks(tx, scope, staff, uploaded.id, input));
    await refreshSurveyProposals(staff, surveyId);
    const proposal = (await listSurveyProposals(staff, surveyId)).find(row => row.fieldPath === "c.details.extended_year" && row.reviewStatus === "pending")!;
    expect(proposal.proposedValue).toEqual({ state: "provided", value: "Document states: 2020" });
    const replaced = await scope((tx, scope) => uploadPreinspectionDocument(tx, scope, upload(makeImageOnlyPdf(), crypto.randomUUID(), uploaded.id), { key: null }));
    expect(await reviewProposal(staff, surveyId, proposal.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ kind: "conflict" });
    const rows = await scope(listPreinspectionDocuments);
    expect(rows.find(row => row.id === uploaded.id)?.supersededAt).not.toBeNull();
    expect(rows.find(row => row.id === replaced.id)?.analysis).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/OCR/) });
    expect(storage.objects.size).toBe(3);
  });
  it("rolls back demo document storage on failure and reports missing storage honestly", async () => {
    const context = { organisationId: org, internalUserId: owner, role: "owner" as const };
    const admin = database.connect(database.adminUrl);
    const previousObjects = storage.objects.size;
    let writes = 0;
    setObjectStorageForTests({ ...storage, async put(key, bytes, type) { await storage.put(key, bytes, type); if (++writes === 2) throw new Error("Simulated partial storage failure"); } });
    try {
      await expect(seedDemoEvidenceDocuments(context, quote, admin)).rejects.toThrow("Simulated partial storage failure");
      expect(storage.objects.size).toBe(previousObjects);
      expect((await scope(listPreinspectionDocuments)).some(row => row.name.startsWith("FICTIONAL-demo-"))).toBe(false);
    } finally { setObjectStorageForTests(storage); }
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", ""); setObjectStorageForTests(null);
    try { await expect(seedDemoEvidenceDocuments(context, quote, admin)).rejects.toMatchObject({ code: "storage_not_configured" }); }
    finally { vi.unstubAllEnvs(); setObjectStorageForTests(storage); }
  });
  it("prepares private demo PDFs idempotently without automatically associating works or filling survey answers", async () => {
    const context = { organisationId: org, internalUserId: owner, role: "owner" as const };
    const admin = database.connect(database.adminUrl);
    await expect(seedDemoEvidenceDocuments({ ...context, internalUserId: surveyor }, quote, admin)).rejects.toMatchObject({ code: "owner_required" });
    await expect(seedDemoEvidenceDocuments(context, crypto.randomUUID(), admin)).rejects.toMatchObject({ status: 404 });
    const before = storage.objects.size;
    const seeded = await seedDemoEvidenceDocuments(context, quote, admin);
    expect(seeded.prepared).toHaveLength(3); expect(seeded.skipped).toBe(0);
    expect(storage.objects.size).toBe(before + 3);
    expect(await seedDemoEvidenceDocuments(context, quote, admin)).toMatchObject({ prepared: [], skipped: 3 });
    const documents = (await scope(listPreinspectionDocuments)).filter(row => row.name.startsWith("FICTIONAL-demo-"));
    expect(documents.every(row => row.worksKind === null && row.associatedAt === null)).toBe(true);
    expect(documents.find(row => row.name.includes("issue-date-only"))?.analysis).toMatchObject({ status: "completed", facts: { worksCompletionDate: null, issueDate: { value: "2021-01-01" } } });
    expect(documents.find(row => row.name.includes("explicit-works"))?.analysis).toMatchObject({ status: "completed", facts: { worksCompletionDate: { value: "2020-06-15" } } });
    expect(documents.find(row => row.name.includes("blank-no-text"))?.analysis).toMatchObject({ status: "unavailable" });
    await refreshSurveyProposals(staff, surveyId);
    expect((await listSurveyProposals(staff, surveyId)).some(row => row.fieldPath === "c.details.extended_year" && row.reviewStatus === "pending")).toBe(false);
    const downloaded = await scope((tx, scope) => downloadPreinspectionDocument(tx, scope, seeded.prepared[0].id));
    expect(new TextDecoder().decode(await downloaded.arrayBuffer())).toContain("FICTIONAL SURVEYNT DEMO");
    const works = documents.find(row => row.name.includes("explicit-works"))!;
    await scope((tx, scope) => uploadPreinspectionDocument(tx, scope, upload(makeTextPdf([["FICTIONAL replacement supplied for manual review"]]), crypto.randomUUID(), works.id), { key: null }));
    expect(await seedDemoEvidenceDocuments(context, quote, admin)).toMatchObject({ prepared: [], skipped: 3 });
    expect((await scope(listPreinspectionDocuments)).find(row => row.id === works.id)?.supersededAt).not.toBeNull();
  });
  it("bounds purpose-link issuance without revoking the last permitted token", async () => {
    let limited = false;
    for (let attempt = 0; attempt < 11; attempt++) {
      try { token = (await publicPreinspection(quote, parentToken, null, (tx, scope) => issuePreinspectionLink(tx, scope, quote))).token; }
      catch (error) { expect(error).toMatchObject({ status: 429, code: "questionnaire_link_rate_limited" }); limited = true; break; }
    }
    expect(limited).toBe(true);
    expect((await scope(readPreinspection)).submission).not.toBeNull();
    // Move test history outside the rolling minute before the independent expiry scenario.
    await database.connect(database.adminUrl).update(preinspectionLinks).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(preinspectionLinks.jobId, job));
  });
  it("revokes scoped links and respects expiry and feature disabling without rewriting evidence", async () => {
    await staffPreinspection({ organisationId: org, internalUserId: owner, role: "owner" }, job, revokePreinspectionLinks);
    await expect(scope(readPreinspection)).rejects.toMatchObject({ status: 404 });
    token = (await publicPreinspection(quote, parentToken, null, (tx, scope) => issuePreinspectionLink(tx, scope, quote))).token;
    const admin = database.connect(database.adminUrl);
    await admin.update(preinspectionLinks).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(preinspectionLinks.tokenHash, createHash("sha256").update(token).digest("hex")));
    await expect(scope(readPreinspection)).rejects.toMatchObject({ status: 404 });
    await admin.update(organisationOperationalSettings).set({ surveyEvidenceEnabled: false }).where(eq(organisationOperationalSettings.organisationId, org));
    await expect(staffPreinspection(staff, job, readPreinspection)).rejects.toMatchObject({ status: 503 });
  });
  it("prepares demo evidence only for a current owner without overwriting answers or expanding privileges", async () => {
    const admin = database.connect(database.adminUrl);
    const context = { organisationId: org, internalUserId: owner, role: "owner" as const };
    await expect(seedDemoEvidence(context, admin)).rejects.toMatchObject({ code: "demo_evidence_setup_required" });
    await admin.update(organisationOperationalSettings).set({ surveyEvidenceEnabled: true }).where(eq(organisationOperationalSettings.organisationId, org));
    const freshJob = crypto.randomUUID();
    await admin.insert(jobs).values({ id: freshJob, organisationId: org, clientId: client, propertyId: property, reference: "DEMO-FIXTURE", serviceName: "Valuation report", assignedSurveyorId: surveyor });
    await expect(seedDemoEvidence({ ...context, internalUserId: surveyor }, admin)).rejects.toMatchObject({ code: "owner_required" });
    const seeded = await seedDemoEvidence(context, admin);
    expect(seeded.prepared).toEqual([{ jobId: freshJob, reference: "DEMO-FIXTURE" }]);
    const view = await staffPreinspection(staff, freshJob, readPreinspection);
    expect(view.submission.answers.agreedPurchasePriceMinor).toBe(42500000);
    expect(view.submission.answers.concerns).toContain("Fictional demo statement:");
    expect((await seedDemoEvidence(context, admin)).prepared).toHaveLength(0);
    await staffPreinspection(staff, freshJob, (tx, scope) => writePreinspection(tx, scope, { version: view.draft.version, requestId: crypto.randomUUID(), answers: { concerns: "Customer's corrected statement" } }, true));
    await seedDemoEvidence(context, admin);
    expect((await staffPreinspection(staff, freshJob, readPreinspection)).submission.answers.concerns).toBe("Customer's corrected statement");
    expect(await createSurvey(context, job, { serviceLevel: "level_2", templateKey: homeSurveyTemplatesV1_1[1].key, templateVersion: "1.1.0" })).toMatchObject({ kind: "invalid", message: "Professional survey recording permission is required." });
    await admin.update(organisations).set({ isDemo: false }).where(eq(organisations.id, org));
    await expect(seedDemoEvidence(context, admin)).rejects.toMatchObject({ code: "demo_evidence_setup_required" });
    await admin.update(organisations).set({ isDemo: true }).where(eq(organisations.id, org));
    await admin.update(organisationMemberships).set({ active: false }).where(eq(organisationMemberships.userId, owner));
    await expect(seedDemoEvidence(context, admin)).rejects.toMatchObject({ code: "owner_required" });
  });
});
