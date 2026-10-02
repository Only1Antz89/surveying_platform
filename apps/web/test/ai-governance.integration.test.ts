import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { aiConsentRecords, aiModelRegister, aiRiskAssessments, auditEvents, clients, createDatabase, jobs, organisations, platformStaff, properties, users, withTenant } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { approveRiskAssessment, createRiskAssessment, governedModelFor, GovernanceError, loadAiGovernance, loadAssistantMetrics, loadJobAiStatus, proposeModel, recordAiConsent, reportAiIncident, setModelStatus, settingsInput, updateAiIncident, updateAiSettings, type GovernanceContext } from "../src/lib/ai-governance";

const firmA = "00000000-0000-0000-0000-0000000000ac";
const firmB = "00000000-0000-0000-0000-0000000000bc";
const disclosure = "We may use an approved AI service to suggest wording; a surveyor reviews every suggestion before it is used.";
const nextYear = `${new Date().getUTCFullYear() + 1}-01-31`;

async function failure(work: Promise<unknown>) {
  try { await work; } catch (error) { return error as GovernanceError & { cause?: { message?: string } }; }
  throw new Error("expected the call to fail");
}

describe.skipIf(!integrationEnabled)("AI governance gate", () => {
  let database: TestDatabase;
  let owner: GovernanceContext;
  let surveyor: GovernanceContext;
  let otherFirm: GovernanceContext;
  let operator = { platformStaffId: "" };
  let jobId = "";
  let otherJobId = "";
  const provider = process.env.AI_PROVIDER;

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl });
    delete process.env.AI_PROVIDER;
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_ac", name: "Firm A", slug: "firm-ac", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_bc", name: "Firm B", slug: "firm-bc", practiceType: "residential", region: "Leeds" },
    ]);
    const [ownerUser, surveyorUser, otherUser] = await admin.insert(users).values([{ clerkUserId: "user_ac_owner", email: "owner@ac.test" }, { clerkUserId: "user_ac_surveyor", email: "surveyor@ac.test" }, { clerkUserId: "user_bc_owner", email: "owner@bc.test" }]).returning();
    owner = { organisationId: firmA, internalUserId: ownerUser.id, role: "owner" };
    surveyor = { organisationId: firmA, internalUserId: surveyorUser.id, role: "surveyor" };
    otherFirm = { organisationId: firmB, internalUserId: otherUser.id, role: "owner" };
    for (const [organisationId, target] of [[firmA, "a"], [firmB, "b"]] as const) {
      const [client] = await admin.insert(clients).values({ organisationId, kind: "individual", displayName: `Client ${target}` }).returning();
      const [property] = await admin.insert(properties).values({ organisationId, clientId: client.id, line1: `${target} Governance Road`, city: "Bristol", postcode: "BS1 1AA", country: "ENG" }).returning();
      const [job] = await admin.insert(jobs).values({ organisationId, clientId: client.id, propertyId: property.id, reference: `AI-${target}`, serviceName: "Condition report" }).returning();
      if (target === "a") jobId = job.id; else otherJobId = job.id;
    }
    const [staff] = await admin.insert(platformStaff).values({ clerkUserId: "user_ai_ops", role: "compliance" }).returning();
    operator = { platformStaffId: staff.id };
  }, 90_000);

  afterEach(() => { delete process.env.AI_PROVIDER; });

  afterAll(async () => {
    if (provider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = provider;
    await database?.drop();
    await stopRelay();
  });

  it("blocks every use by default and lists every reason", async () => {
    const status = await loadJobAiStatus(owner, jobId);
    expect(status.consents).toEqual([]);
    expect(status.gates.every((gate) => !gate.allowed && gate.model === null)).toBe(true);
    expect(status.gates[0].reasons.map((reason) => reason.code)).toEqual(["provider_none", "firm_disabled", "no_risk_assessment", "no_consent"]);
    const { model } = await governedModelFor(owner, jobId, "field_proposals");
    expect(model.available).toBe(false);
    await expect(model.propose({} as never)).resolves.toMatchObject({ status: "unavailable", reason: expect.stringMatching(/No AI provider/) });
    expect((await loadAiGovernance(owner)).settings).toMatchObject({ aiFeaturesEnabled: false, permittedUses: [], disclosureVersion: 0 });
  });

  it("requires a disclosure before enabling and refuses consent the firm has not permitted", async () => {
    expect(settingsInput.safeParse({ aiFeaturesEnabled: true, permittedUses: ["report_prose"], disclosureText: null, version: 0 }).success).toBe(false);
    expect(await failure(recordAiConsent(owner, jobId, { status: "granted", uses: ["report_prose"], method: "written" }))).toMatchObject({ status: 409, code: "ai_disabled" });
    expect(await failure(updateAiSettings(surveyor, { aiFeaturesEnabled: true, permittedUses: ["report_prose"], disclosureText: disclosure, version: 0 }))).toMatchObject({ status: 403 });
    const saved = await updateAiSettings(owner, { aiFeaturesEnabled: true, permittedUses: ["report_prose"], disclosureText: disclosure, version: 0 });
    expect(saved).toMatchObject({ aiFeaturesEnabled: true, disclosureVersion: 1, version: 1 });
    expect(await failure(updateAiSettings(owner, { aiFeaturesEnabled: true, permittedUses: ["report_prose"], disclosureText: disclosure, version: 0 }))).toMatchObject({ status: 409, code: "version_conflict" });
    expect(await failure(recordAiConsent(surveyor, jobId, { status: "granted", uses: ["photo_observation"], method: "written" }))).toMatchObject({ status: 422, code: "use_not_permitted" });
    const consent = await recordAiConsent(surveyor, jobId, { status: "granted", uses: ["report_prose"], method: "terms_of_engagement" });
    expect(consent).toMatchObject({ disclosureVersion: 1, uses: ["report_prose"] });
    expect(await failure(recordAiConsent(otherFirm, jobId, { status: "granted", uses: ["report_prose"], method: "written" }))).toMatchObject({ status: 404, code: "job_not_found" });
  });

  it("allows a use only when the provider, register, firm, risk assessment and consent all agree", async () => {
    const draft = await createRiskAssessment(surveyor, { use: "report_prose", title: "Drafted report text", summary: "Prose drafts are reviewed line by line before approval.", risks: [{ risk: "Unsupported statement", likelihood: "medium", impact: "high", mitigation: "Claims must cite an approved observation." }], reviewDue: nextYear });
    expect(await failure(approveRiskAssessment(surveyor, draft.id))).toMatchObject({ status: 403 });
    await approveRiskAssessment(owner, draft.id);

    process.env.AI_PROVIDER = "fakeprovider";
    let gate = (await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")!;
    expect(gate.reasons.map((reason) => reason.code)).toEqual(["not_registered"]);

    const model = await proposeModel(operator, { providerKey: "fakeprovider", modelId: "test-model", modelVersion: "2026-09", uses: ["report_prose"], processingLocation: "UK", retentionTerms: "No retention beyond the request." });
    expect(await failure(setModelStatus(operator, model.id, { status: "approved" }))).toMatchObject({ status: 422, code: "evaluation_required" });
    await setModelStatus(operator, model.id, { status: "approved", evaluationSummary: { pack: "evidence-eval", passed: 11, failed: 0 } });
    gate = (await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")!;
    expect(gate).toMatchObject({ allowed: true, reasons: [], model: { providerKey: "fakeprovider", modelId: "test-model", modelVersion: "2026-09" } });
    expect((await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "photo_observation")).toMatchObject({ allowed: false });
    expect((await loadJobAiStatus(otherFirm, otherJobId)).gates.find((item) => item.use === "report_prose")).toMatchObject({ allowed: false, reasons: expect.arrayContaining([expect.objectContaining({ code: "firm_disabled" }), expect.objectContaining({ code: "no_consent" })]) });

    const admin = database.connect(database.adminUrl);
    const audit = await admin.select().from(auditEvents).where(eq(auditEvents.resourceId, model.id));
    expect(audit.map((row) => row.action).sort()).toEqual(["ai.model_approved", "ai.model_proposed"]);

    await setModelStatus(operator, model.id, { status: "suspended" });
    gate = (await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")!;
    expect(gate.reasons.map((reason) => reason.code)).toEqual(["not_registered"]);
    await setModelStatus(operator, model.id, { status: "approved", evaluationSummary: { pack: "evidence-eval", passed: 11, failed: 0 } });
  });

  it("asks for consent again after the disclosure changes, and honours withdrawal", async () => {
    process.env.AI_PROVIDER = "fakeprovider";
    const current = await loadAiGovernance(owner);
    await updateAiSettings(owner, { aiFeaturesEnabled: true, permittedUses: ["report_prose"], disclosureText: `${disclosure} You can decline at any time.`, version: current.settings.version });
    let gate = (await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")!;
    expect(gate.reasons.map((reason) => reason.code)).toEqual(["consent_disclosure_outdated"]);
    await recordAiConsent(owner, jobId, { status: "granted", uses: ["report_prose"], method: "electronic" });
    expect((await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")?.allowed).toBe(true);
    await recordAiConsent(owner, jobId, { status: "withdrawn", uses: [], method: "written", note: "Client asked for no AI." });
    gate = (await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")!;
    expect(gate.reasons.map((reason) => reason.code)).toEqual(["consent_withdrawn"]);
    await recordAiConsent(owner, jobId, { status: "granted", uses: ["report_prose"], method: "electronic" });
    expect((await loadJobAiStatus(owner, jobId)).consents.map((item) => item.status)).toEqual(["granted", "withdrawn", "granted", "granted"]);
  });

  it("suspends use while a critical incident is open and needs a correction note to close it", async () => {
    process.env.AI_PROVIDER = "fakeprovider";
    const incident = await reportAiIncident(surveyor, { category: "unsupported_claim", severity: "critical", description: "A drafted sentence cited no observation.", jobId });
    expect((await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")?.reasons.map((reason) => reason.code)).toEqual(["open_critical_incident"]);
    expect(await failure(updateAiIncident(surveyor, incident.id, { status: "investigating" }))).toMatchObject({ status: 403 });
    expect(await failure(updateAiIncident(owner, incident.id, { status: "closed" }))).toMatchObject({ status: 422, code: "correction_required" });
    await updateAiIncident(owner, incident.id, { status: "investigating" });
    expect((await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")?.allowed).toBe(false);
    await updateAiIncident(owner, incident.id, { status: "closed", correctionNote: "Sentence removed; composer now requires a citation." });
    expect((await loadJobAiStatus(owner, jobId)).gates.find((item) => item.use === "report_prose")?.allowed).toBe(true);
    expect(await failure(updateAiIncident(owner, incident.id, { status: "investigating" }))).toMatchObject({ status: 404 });
  });

  it("keeps consent and approved assessments immutable, supersedes on approval and isolates firms", async () => {
    const admin = database.connect(database.adminUrl);
    await expect(admin.update(aiConsentRecords).set({ note: "edited" }).where(sql`true`)).rejects.toThrow();
    await expect(admin.delete(aiConsentRecords).where(sql`true`)).rejects.toThrow();
    const [approved] = await admin.select().from(aiRiskAssessments).where(eq(aiRiskAssessments.status, "approved"));
    await expect(admin.update(aiRiskAssessments).set({ summary: "Rewritten after approval to hide a risk." }).where(eq(aiRiskAssessments.id, approved.id))).rejects.toThrow();
    await expect(admin.delete(aiRiskAssessments).where(eq(aiRiskAssessments.id, approved.id))).rejects.toThrow();

    const second = await createRiskAssessment(owner, { use: "report_prose", title: "Drafted report text (revised)", summary: "Revised after the unsupported-claim incident.", risks: [{ risk: "Unsupported statement", likelihood: "low", impact: "high", mitigation: "Composer requires a citation." }], reviewDue: nextYear });
    await approveRiskAssessment(owner, second.id);
    const statuses = await admin.select({ id: aiRiskAssessments.id, status: aiRiskAssessments.status }).from(aiRiskAssessments);
    expect(statuses.find((row) => row.id === approved.id)?.status).toBe("superseded");
    expect(statuses.find((row) => row.id === second.id)?.status).toBe("approved");

    const app = createDatabase(database.appUrl);
    expect(await withTenant(app, firmB, (tx) => tx.select().from(aiConsentRecords))).toEqual([]);
    expect(await withTenant(app, firmB, (tx) => tx.select().from(aiRiskAssessments))).toEqual([]);
    expect((await loadAiGovernance(otherFirm)).assessments).toEqual([]);
    await expect(withTenant(app, firmB, (tx) => tx.insert(aiConsentRecords).values({ organisationId: firmA, jobId, status: "granted", uses: ["report_prose"], disclosureVersion: 2, method: "written" }))).rejects.toThrow();
    await expect(withTenant(app, firmB, (tx) => tx.insert(aiConsentRecords).values({ organisationId: firmB, jobId, status: "granted", uses: ["report_prose"], disclosureVersion: 2, method: "written" }))).rejects.toThrow();
  });

  it("lets the application role read the model register but never change it", async () => {
    const app = createDatabase(database.appUrl);
    expect((await withTenant(app, firmA, (tx) => tx.select().from(aiModelRegister))).length).toBe(1);
    await expect(withTenant(app, firmA, (tx) => tx.insert(aiModelRegister).values({ providerKey: "rogue", modelId: "x", modelVersion: "1", uses: ["report_prose"], status: "approved", processingLocation: "anywhere", retentionTerms: "unknown terms" }))).rejects.toThrow();
    const changed = await withTenant(app, firmA, (tx) => tx.update(aiModelRegister).set({ status: "approved", uses: ["report_prose", "photo_observation"] }).returning());
    expect(changed).toEqual([]);
    const deleted = await withTenant(app, firmA, (tx) => tx.delete(aiModelRegister).returning());
    expect(deleted).toEqual([]);
  });

  it("reports platform metrics as totals without naming firms", async () => {
    const metrics = await loadAssistantMetrics();
    expect(metrics.firms).toEqual({ ai_enabled: 1, configured: 1 });
    expect(metrics.incidents).toEqual([{ category: "unsupported_claim", severity: "critical", status: "closed", count: 1 }]);
    expect(JSON.stringify(metrics)).not.toMatch(new RegExp(`${firmA}|Firm A|Governance Road`));
  });
});
