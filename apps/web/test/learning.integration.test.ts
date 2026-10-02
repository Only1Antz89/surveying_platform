import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  clientContacts, clients, createDatabase, jobs, learningAuditLog, learningCandidates, learningContributionGrants, learningPolicyVersions, learningReviews, learningSanitisationRuns,
  organisationMemberships, organisations, platformStaff, properties, users, withTenant,
} from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { isFieldRequired, listFields, residentialTemplateV1, type FieldDefinition, type FieldValue, type SyncOperation } from "@surveynt/assistant";
import type { ReleaseCriteria } from "@surveynt/learning";
import { grantInput, LearningError, loadLearningDashboard, recordContributionGrant, requestWithdrawal, type LearningContext } from "../src/lib/learning";
import { publishPolicy, recordPrivacyDecision, savePolicyDraft, type LearningOperator } from "../src/lib/learning-admin";
import { extractFirmCandidates, runLearningSweep } from "../src/lib/learning-pipeline";
import { approveReportVersion, composeSurveyReport } from "../src/lib/reports";
import { applySyncOperations, createSurvey, type SurveyContext } from "../src/lib/surveys";

const firmA = "00000000-0000-0000-0000-0000000000ad";
const firmB = "00000000-0000-0000-0000-0000000000bd";
let counter = 0;
const op = () => `op_learning_${(counter += 1).toString().padStart(6, "0")}`;
const confirmations = ["client_information_authority", "third_party_rights", "policy_accepted"] as const;
const criteria: ReleaseCriteria = { definedBy: "Synthetic test panel", minimumCasesPerRelease: 1, maxContributorShare: 1, rareCombinationReviewBelow: 2, minimumTechnicalAgreement: null, coverageDimensions: ["jurisdiction", "elementKey"], licenceScope: "Shared retrieval inside Surveynt only; no publication." };
const identifiers = /Jane|Doe|Acacia|BS8|07700|LRN-1001|Maya|Patel|Clifton/;

function sample(field: FieldDefinition): FieldValue {
  switch (field.type) {
    case "enum": return { state: "provided", value: field.key === "listed_status" || field.key === "conservation_area" ? "no_record_found" : field.options![0].value };
    case "integer": case "decimal": return { state: "provided", value: field.min ?? 1 };
    case "boolean": return { state: "provided", value: false };
    case "date": return { state: "provided", value: "2026-09-28" };
    default: return { state: "provided", value: `Recorded ${field.key.replace(/_/g, " ")}.` };
  }
}

/** A complete level 1 survey: roof coverings inspected with a defect and a client statement; every other building element not applicable. */
function surveyOperations(): SyncOperation[] {
  const operations: SyncOperation[] = [];
  for (const section of residentialTemplateV1.sections) for (const element of section.elements) {
    if (!element.inspectable) continue;
    const roof = section.key === "outside" && element.key === "roof_coverings";
    operations.push({ type: "set_element", operationId: op(), element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, inspectionStatus: roof ? "inspected" : "not_applicable", limitationReason: null, baseVersion: null });
  }
  for (const resolved of listFields(residentialTemplateV1)) {
    if (!resolved.element.inspectable && isFieldRequired(resolved.field, { serviceLevel: "level_1" })) operations.push({ type: "set_field", operationId: op(), fieldPath: resolved.path, value: sample(resolved.field), baseValueId: null });
  }
  const roof = { sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "" };
  operations.push(
    { type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.condition_rating", value: { state: "provided", value: "2" }, baseValueId: null },
    { type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.construction", value: { state: "provided", value: "Pitched roof with natural slate, seen from the garden of 14 Acacia Avenue." }, baseValueId: null },
    { type: "add_observation", operationId: op(), element: roof, kind: "current_observation", text: "Slipped slates above Jane Doe's bedroom; call 07700 900123 for access." },
    { type: "add_observation", operationId: op(), element: roof, kind: "client_claim", text: "Mrs Doe says the roof was replaced on 3 June 2015 (job LRN-1001)." },
  );
  return operations;
}

async function failure(work: Promise<unknown>) {
  try { await work; } catch (error) { return error as LearningError & { cause?: { message?: string } }; }
  throw new Error("expected the call to fail");
}
async function denied(work: Promise<unknown>) {
  const error = await failure(work);
  expect(String(error.cause?.message ?? error.message)).toMatch(/permission denied/);
}

describe.skipIf(!integrationEnabled)("shared learning controls and restricted staging", () => {
  let database: TestDatabase;
  let owner: LearningContext;
  let surveyor: SurveyContext;
  let coordinator: LearningContext;
  let compliance: LearningOperator;
  let privacy: LearningOperator;
  let jobId = "";
  let policyId = "";

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, DATABASE_LEARNING_URL: database.learningUrl, LEARNING_LINEAGE_SECRET: "synthetic-lineage-secret-for-tests-only-0001" });
    delete process.env.SHARED_LEARNING_ENABLED;
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_ad", name: "Clifton Test Surveyors", slug: "firm-ad", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_bd", name: "Firm B", slug: "firm-bd", practiceType: "residential", region: "Leeds" },
    ]);
    const [ownerUser, surveyorUser] = await admin.insert(users).values([{ clerkUserId: "user_ad_owner", email: "owner@ad.test", firstName: "Maya", lastName: "Patel" }, { clerkUserId: "user_ad_surveyor", email: "surveyor@ad.test", firstName: "Sam", lastName: "Okafor" }]).returning();
    await admin.insert(organisationMemberships).values([{ organisationId: firmA, userId: ownerUser.id, role: "owner" }, { organisationId: firmA, userId: surveyorUser.id, role: "surveyor" }]);
    owner = { organisationId: firmA, internalUserId: ownerUser.id, role: "owner" };
    surveyor = { organisationId: firmA, internalUserId: surveyorUser.id, role: "surveyor" };
    coordinator = { organisationId: firmA, internalUserId: surveyorUser.id, role: "coordinator" };
    const [client] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Jane Doe", email: "jane@doe.test" }).returning();
    await admin.insert(clientContacts).values({ organisationId: firmA, clientId: client.id, name: "John Doe", phone: "07700 900123" });
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: client.id, line1: "14 Acacia Avenue", city: "Bristol", postcode: "BS8 1AA", country: "ENG" }).returning();
    [{ id: jobId }] = await admin.insert(jobs).values({ organisationId: firmA, clientId: client.id, propertyId: property.id, reference: "LRN-1001", serviceName: "Condition report", stage: "internal_review" }).returning();
    const created = await createSurvey(surveyor, jobId, { serviceLevel: "level_1" });
    if (created.kind !== "created") throw new Error(created.kind);
    const results = await applySyncOperations(surveyor, created.survey.id, surveyOperations());
    expect(results.filter((result) => result.status !== "applied")).toEqual([]);
    const composed = await composeSurveyReport(surveyor, created.survey.id);
    await approveReportVersion(surveyor, created.survey.id, composed.id, { confirm: true });
    const [complianceStaff, privacyStaff] = await admin.insert(platformStaff).values([{ clerkUserId: "user_ld_compliance", role: "compliance" }, { clerkUserId: "user_ld_privacy", role: "privacy_reviewer" }]).returning();
    compliance = { platformStaffId: complianceStaff.id, role: "compliance" };
    privacy = { platformStaffId: privacyStaff.id, role: "privacy_reviewer" };
  }, 120_000);

  afterAll(async () => {
    delete process.env.SHARED_LEARNING_ENABLED;
    await database?.drop();
    await stopRelay();
  });

  it("is off by default: nothing can be granted or extracted", async () => {
    const dashboard = await loadLearningDashboard(owner);
    expect(dashboard.programme).toMatchObject({ active: false, policy: null });
    expect(dashboard.programme.reasons.map((reason) => reason.code)).toEqual(["flag_off", "no_published_policy"]);
    expect(dashboard.scopes.every((scope) => scope.status === "not_granted")).toBe(true);
    expect(await failure(recordContributionGrant(owner, { scope: "structured_cases", status: "granted", confirmations: [...confirmations], basis: "Clause 12 of our terms of engagement." }))).toMatchObject({ status: 409, code: "programme_inactive" });
    expect(await extractFirmCandidates(firmA)).toMatchObject({ status: "inactive", created: 0 });
    expect(await runLearningSweep()).toMatchObject({ firms: 0, created: 0 });
    expect(await database.connect(database.adminUrl).select().from(learningCandidates)).toEqual([]);
  });

  it("publishes a policy only with a privacy assessment and complete release criteria", async () => {
    expect(await failure(savePolicyDraft(privacy, { version: "2027-01", summary: "Contribution policy for the synthetic test programme.", policyDocumentRef: "docs/shared-learning/policy.md", privacyAssessmentRef: null, releaseCriteria: {} }))).toMatchObject({ status: 403 });
    const draft = await savePolicyDraft(compliance, { version: "2027-01", summary: "Contribution policy for the synthetic test programme.", policyDocumentRef: "docs/shared-learning/policy.md", privacyAssessmentRef: null, releaseCriteria: { definedBy: "x" } });
    policyId = draft.id;
    expect(await failure(publishPolicy(compliance, policyId))).toMatchObject({ status: 422, code: "privacy_assessment_required" });
    await savePolicyDraft(compliance, { version: "2027-01", summary: draft.summary, policyDocumentRef: draft.policyDocumentRef, privacyAssessmentRef: "DPIA-SYNTHETIC-1", releaseCriteria: { definedBy: "x" } }, policyId);
    expect(await failure(publishPolicy(compliance, policyId))).toMatchObject({ status: 422, code: "release_criteria_incomplete" });
    await savePolicyDraft(compliance, { version: "2027-01", summary: draft.summary, policyDocumentRef: draft.policyDocumentRef, privacyAssessmentRef: "DPIA-SYNTHETIC-1", releaseCriteria: criteria }, policyId);
    expect(await publishPolicy(compliance, policyId)).toMatchObject({ status: "published" });
    const admin = database.connect(database.adminUrl);
    await expect(admin.update(learningPolicyVersions).set({ summary: "Quietly changed after publication." }).where(eq(learningPolicyVersions.id, policyId))).rejects.toThrow();
    await expect(withTenant(createDatabase(database.appUrl), firmA, (tx) => tx.insert(learningPolicyVersions).values({ version: "rogue", summary: "A firm cannot publish policy.", policyDocumentRef: "none", status: "draft" }))).rejects.toThrow();
    expect((await loadLearningDashboard(owner)).programme.reasons.map((reason) => reason.code)).toEqual(["flag_off"]);
  });

  it("extracts only after the flag and the firm's confirmed grant, and stages sanitised copies", async () => {
    process.env.SHARED_LEARNING_ENABLED = "true";
    expect(await extractFirmCandidates(firmA)).toMatchObject({ status: "done", created: 0, skipped: [{ reasons: ["scope_not_granted"] }] });
    expect(grantInput.safeParse({ scope: "structured_cases", status: "granted", confirmations: ["policy_accepted"], basis: "Clause 12 of our terms." }).success).toBe(false);
    expect(await failure(recordContributionGrant({ ...owner, role: "surveyor" }, { scope: "structured_cases", status: "granted", confirmations: [...confirmations], basis: "Clause 12 of our terms of engagement." }))).toMatchObject({ status: 403 });
    await recordContributionGrant(owner, { scope: "structured_cases", status: "granted", confirmations: [...confirmations], basis: "Clause 12 of our terms of engagement." });
    expect((await loadLearningDashboard(owner)).scopes.find((scope) => scope.scope === "structured_cases")).toMatchObject({ status: "granted", policyVersion: "2027-01" });

    const outcome = await extractFirmCandidates(firmA);
    expect(outcome).toMatchObject({ status: "done", surveys: 1, created: 1, quarantined: 1 });
    expect(await extractFirmCandidates(firmA)).toMatchObject({ created: 0, surveys: 0 });

    const admin = database.connect(database.adminUrl);
    const [candidate] = await admin.select().from(learningCandidates);
    expect(candidate).toMatchObject({ organisationId: firmA, jobId, elementRef: "outside.roof_coverings", scope: "structured_cases", status: "quarantined", policyVersion: "2027-01" });
    expect(candidate.dedupKey).toMatch(/^[0-9a-f]{64}$/);
    const [run] = await admin.select().from(learningSanitisationRuns);
    expect(JSON.stringify(run.output)).not.toMatch(identifiers);
    expect(run.output).toMatchObject({ jurisdiction: "ENG", elementKey: "outside.roof_coverings", conditionRating: "2", nextActions: [], text: { clientStatements: [expect.stringContaining("2015")] } });
    expect(run.flags).toEqual(expect.arrayContaining(["free_text_requires_rewrite", "client_statement_unverified", "rare_combination"]));
    expect(run.findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining(["known_name", "known_reference", "known_address", "titled_name", "date"]));
    expect((await loadLearningDashboard(owner)).counts).toEqual([{ scope: "structured_cases", status: "quarantined", cases: 1 }]);
    expect((await loadLearningDashboard({ organisationId: firmB })).counts).toEqual([]);
  });

  it("keeps restricted staging out of reach of the tenant role, and tenant data out of reach of the learning role", async () => {
    const app = createDatabase(database.appUrl);
    await denied(withTenant(app, firmA, (tx) => tx.select().from(learningCandidates)));
    await denied(withTenant(app, firmA, (tx) => tx.select().from(learningSanitisationRuns)));
    const learning = database.connect(database.learningUrl);
    await denied(learning.execute(sql`select * from surveys`));
    await denied(learning.execute(sql`select * from clients`));
    await denied(learning.select().from(learningContributionGrants));
    await expect(learning.delete(learningCandidates).where(sql`true`)).rejects.toThrow();
    await expect(learning.update(learningCandidates).set({ jobId: firmB }).where(sql`true`)).rejects.toThrow();
    await expect(learning.update(learningSanitisationRuns).set({ flags: [] }).where(sql`true`)).rejects.toThrow();
    expect(await withTenant(app, firmB, (tx) => tx.select().from(learningContributionGrants))).toEqual([]);
  });

  it("lets only privacy reviewers decide, with every check to approve and a reason to reject", async () => {
    const admin = database.connect(database.adminUrl);
    const [candidate] = await admin.select().from(learningCandidates);
    expect(await failure(recordPrivacyDecision(compliance, candidate.id, { decision: "approved", checks: [] }))).toMatchObject({ status: 403 });
    await expect(recordPrivacyDecision(privacy, candidate.id, { decision: "approved", checks: ["identifiers_removed"] })).rejects.toThrow();
    const checks = ["identifiers_removed", "free_text_reviewed", "rare_combination_assessed", "linkage_listings_checked", "linkage_planning_checked", "linkage_other_public_checked"] as const;
    expect(await recordPrivacyDecision(privacy, candidate.id, { decision: "approved", checks: [...checks] })).toEqual({ status: "awaiting_technical_review" });
    expect(await failure(recordPrivacyDecision(privacy, candidate.id, { decision: "approved", checks: [...checks] }))).toMatchObject({ status: 409 });

    const learning = database.connect(database.learningUrl);
    const [rejectable] = await learning.insert(learningCandidates).values({ ...candidate, id: undefined, sourceFingerprint: "synthetic:reject", status: "awaiting_privacy_review", createdAt: undefined, updatedAt: undefined }).returning();
    expect(await recordPrivacyDecision(privacy, rejectable.id, { decision: "rejected", checks: [], note: "Narrative is unique to one household." })).toEqual({ status: "rejected" });
    await expect(learning.update(learningReviews).set({ note: "edited" }).where(sql`true`)).rejects.toThrow();
    expect((await admin.select().from(learningAuditLog).where(eq(learningAuditLog.actorStaffId, privacy.platformStaffId))).map((row) => row.action).sort()).toEqual(["privacy.approved", "privacy.rejected"]);
  });

  it("propagates withdrawal: copies cleared, reviews erased, lineage and audit kept, and revocation withdraws", async () => {
    const outcome = await requestWithdrawal(coordinator, { scope: null, jobId, reason: "The client objected to any reuse." });
    expect(outcome.processed).toMatchObject({ status: "completed", candidatesWithdrawn: 2 });
    const admin = database.connect(database.adminUrl);
    const candidates = await admin.select().from(learningCandidates);
    expect(candidates.every((item) => item.status === "withdrawn" && JSON.stringify(item.content) === "{}")).toBe(true);
    expect(await admin.select().from(learningSanitisationRuns)).toEqual([]);
    expect(await admin.select().from(learningReviews)).toEqual([]);
    expect((await admin.select().from(learningAuditLog).where(eq(learningAuditLog.action, "withdrawal.processed")))).toHaveLength(1);
    const learning = database.connect(database.learningUrl);
    await expect(learning.update(learningCandidates).set({ status: "awaiting_privacy_review" }).where(sql`true`)).rejects.toThrow();
    const dashboard = await loadLearningDashboard(owner);
    expect(dashboard.withdrawals[0]).toMatchObject({ status: "completed", jobReference: "LRN-1001", outcome: { candidatesWithdrawn: 2 } });
    expect(dashboard.counts).toEqual([{ scope: "structured_cases", status: "withdrawn", cases: 2 }]);

    const revoked = await recordContributionGrant(owner, { scope: "structured_cases", status: "revoked", confirmations: [], basis: null });
    expect(revoked.withdrawal).toMatchObject({ status: "completed", candidatesWithdrawn: 0 });
    expect((await loadLearningDashboard(owner)).scopes.find((scope) => scope.scope === "structured_cases")?.status).toBe("revoked");
    await expect(admin.update(learningContributionGrants).set({ basis: "edited" }).where(sql`true`)).rejects.toThrow();
  });
});
