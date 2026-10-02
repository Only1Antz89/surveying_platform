import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  clients, createDatabase, jobs, learningAuditLog, learningCandidates, learningCaseFeedback, learningContributionGrants, learningContributors, learningEvaluationRuns, learningPolicyVersions,
  learningReleaseItems, learningReviews, learningSanitisationRuns, organisations, platformStaff, properties, withTenant,
} from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import type { ReleaseCriteria, ReviewedCase, SanitisedCase } from "@surveynt/learning";
import { feedbackInput, recordCaseFeedback, type LearningContext } from "../src/lib/learning";
import { activateRelease, approveRelease, createReleaseDraft, loadCaseFeedback, loadFineTuningGate, recordTechnicalDecision, retractSharedCase, runRetrievalEvaluation, signOffReleasePrivacy, type LearningOperator } from "../src/lib/learning-admin";
import { searchSharedCases } from "../src/lib/shared-cases";

// A synthetic corpus: five contributing firms, four properties each, two
// elements per property; firm F contributes nothing.
const firmIds = { a: "00000000-0000-0000-0000-0000000000af", b: "00000000-0000-0000-0000-0000000000bf", c: "00000000-0000-0000-0000-0000000000cf", d: "00000000-0000-0000-0000-0000000000df", e: "00000000-0000-0000-0000-0000000000ef", f: "00000000-0000-0000-0000-0000000000ff" };
type Firm = keyof typeof firmIds;
const contributing: Firm[] = ["a", "b", "c", "d", "e"];
const criteria: ReleaseCriteria = { definedBy: "Synthetic test panel", minimumCasesPerRelease: 10, maxContributorShare: 0.3, rareCombinationReviewBelow: 2, minimumTechnicalAgreement: null, coverageDimensions: ["jurisdiction", "elementKey", "rating"], licenceScope: "Shared retrieval inside Surveynt only; no publication." };
const confirmations = ["client_information_authority", "third_party_rights", "policy_accepted"];
const elements = [
  { key: "outside.roof_coverings", label: "Roof coverings", feature: (n: number) => `Slipped slates on the rear roof slope, about ${n + 2} in number.`, rating: (n: number) => (n % 2 ? "2" : "1") },
  { key: "outside.chimney_stacks", label: "Chimney stacks", feature: (n: number) => `Chimney stack with open mortar joints and ${n % 2 ? "a slight lean" : "no lean"}.`, rating: (n: number) => (n % 2 ? "3" : "2") },
];

describe.skipIf(!integrationEnabled)("shared learning feedback, corrections, evaluation and the fine-tuning gate", () => {
  let database: TestDatabase;
  let privacy: LearningOperator;
  let technical: LearningOperator;
  let manager: LearningOperator;
  let compliance: LearningOperator;
  const members: Record<string, LearningContext> = {};
  const caseIds: Record<string, string> = {};

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, DATABASE_LEARNING_URL: database.learningUrl, LEARNING_LINEAGE_SECRET: "synthetic-lineage-secret-for-tests-only-0003", SHARED_LEARNING_ENABLED: "true", ASSISTANT_ENABLED: "true" });
    const admin = database.connect(database.adminUrl);
    const learning = database.connect(database.learningUrl);
    await admin.insert(organisations).values(Object.entries(firmIds).map(([key, id]) => ({ id, clerkOrganisationId: `org_${key}f`, name: `Firm ${key.toUpperCase()}`, slug: `firm-${key}f`, practiceType: "residential", region: "Bristol" })));
    await admin.insert(learningPolicyVersions).values({ version: "2027-01", status: "published", summary: "Synthetic policy for evaluation tests.", policyDocumentRef: "docs/shared-learning/policy.md", privacyAssessmentRef: "DPIA-SYNTHETIC-3", releaseCriteria: criteria, publishedAt: new Date() });
    const staff = await admin.insert(platformStaff).values([{ clerkUserId: "user_lf_privacy", role: "privacy_reviewer" }, { clerkUserId: "user_lf_technical", role: "technical_reviewer" }, { clerkUserId: "user_lf_manager", role: "release_manager" }, { clerkUserId: "user_lf_compliance", role: "compliance" }]).returning();
    [privacy, technical, manager, compliance] = staff.map((row) => ({ platformStaffId: row.id, role: row.role }));
    for (const [key, organisationId] of Object.entries(firmIds) as [Firm, string][]) {
      members[key] = { organisationId, internalUserId: null, role: "surveyor" };
      if (!contributing.includes(key)) continue;
      const scopes = ["structured_cases", ...(key !== "e" ? ["evaluation"] : []), ...(key === "a" ? ["model_training"] : [])];
      await admin.insert(learningContributionGrants).values(scopes.map((scope) => ({ organisationId, scope, status: "granted", policyVersion: "2027-01", confirmations, basis: "Clause 12 of our terms of engagement." })));
      const [client] = await admin.insert(clients).values({ organisationId, kind: "individual", displayName: `Client ${key}` }).returning();
      await learning.insert(learningContributors).values({ organisationId });
      const [contributor] = await learning.select().from(learningContributors).where(eq(learningContributors.organisationId, organisationId));
      for (let propertyIndex = 0; propertyIndex < 4; propertyIndex += 1) {
        const [property] = await admin.insert(properties).values({ organisationId, clientId: client.id, line1: `${propertyIndex} Corpus Road`, city: "Bristol", postcode: "BS1 1AA", country: "ENG" }).returning();
        const [job] = await admin.insert(jobs).values({ organisationId, clientId: client.id, propertyId: property.id, reference: `EV-${key}-${propertyIndex}`, serviceName: "Condition report" }).returning();
        for (const element of elements) {
          const n = propertyIndex + contributing.indexOf(key);
          const output: SanitisedCase = { jurisdiction: "ENG", serviceLevel: "level_2", template: "surveynt-residential@1", property: { propertyType: "house", builtForm: null, ageBand: "1919_1944", storeys: null }, elementKey: element.key, elementLabel: element.label, inspectionStatus: "inspected", limitation: null, conditionRating: element.rating(n), nextActions: [], text: { construction: null, surveyorObservations: [element.feature(n)], clientStatements: [], recordContext: [], commentary: null, limitations: null }, photoCount: 0 };
          const [candidate] = await learning.insert(learningCandidates).values({ organisationId, contributorKey: contributor.contributorKey, jobId: job.id, surveyId: job.id, elementId: crypto.randomUUID(), elementRef: element.key, scope: "structured_cases", grantId: crypto.randomUUID(), policyVersion: "2027-01", sourceFingerprint: `synthetic:${key}:${propertyIndex}:${element.key}`, dedupKey: `${key}${propertyIndex}|${element.key}`, groupKey: `${key}${propertyIndex}`, content: { synthetic: true }, status: "awaiting_technical_review" }).returning();
          await learning.insert(learningSanitisationRuns).values({ candidateId: candidate.id, transformer: "sanitiser-v1", output: output as unknown as Record<string, unknown>, quasiKey: `${key}${propertyIndex}${element.key}`, outcome: "passed" });
          await learning.insert(learningReviews).values({ candidateId: candidate.id, stage: "privacy", reviewerStaffId: privacy.platformStaffId, decision: "approved", checks: ["identifiers_removed"] });
          const reviewed: ReviewedCase = { observedFeature: element.feature(n), possibleCauses: [], confirmedCause: null, confirmationBasis: null, surveyorJudgement: "A judgement written for the synthetic corpus.", ratingExample: element.rating(n) as ReviewedCase["ratingExample"], nextSteps: [], limitations: null, uncertainty: "low", evidenceStrength: "observed", knowledgeReviewDue: "2029-01-01", ratingDisagreement: false, noDefect: false };
          await recordTechnicalDecision(technical, candidate.id, { decision: "approved", reviewed });
          caseIds[`${key}${propertyIndex}:${element.key}`] = candidate.id;
        }
      }
    }
    const draft = await createReleaseDraft(manager, { version: "2027.1" });
    expect(draft.problems).toEqual([]);
    await signOffReleasePrivacy(privacy, draft.id, "Synthetic corpus; linkage checked against nothing real.");
    await approveRelease(manager, draft.id);
    await activateRelease(manager, draft.id);
  }, 180_000);

  afterAll(async () => {
    delete process.env.SHARED_LEARNING_ENABLED;
    delete process.env.ASSISTANT_ENABLED;
    await database?.drop();
    await stopRelay();
  });

  const sharedIdFor = async (name: string) => {
    const [item] = await database.connect(database.adminUrl).select({ id: learningReleaseItems.sharedCaseId }).from(learningReleaseItems).where(eq(learningReleaseItems.candidateId, caseIds[name])).limit(1);
    return item.id;
  };

  it("records feedback from any firm, privately, and never names the firm to reviewers", async () => {
    const helpful = await sharedIdFor("b0:outside.roof_coverings");
    expect(await recordCaseFeedback(members.f, helpful, { rating: "helpful" })).toMatchObject({ suspended: false });
    expect(feedbackInput.safeParse({ rating: "incorrect" }).success).toBe(false);
    const incorrect = await sharedIdFor("b1:outside.chimney_stacks");
    await recordCaseFeedback(members.c, incorrect, { rating: "incorrect", note: "The rating seems too severe for the description." });
    await expect(recordCaseFeedback({ ...members.f, role: "read_only" }, helpful, { rating: "helpful" })).rejects.toMatchObject({ status: 403 });
    const app = createDatabase(database.appUrl);
    expect(await withTenant(app, firmIds.a, (tx) => tx.select().from(learningCaseFeedback))).toEqual([]);
    await expect(database.connect(database.adminUrl).update(learningCaseFeedback).set({ note: "edited" }).where(sql`true`)).rejects.toThrow();
    const summary = await loadCaseFeedback();
    expect(summary[0]).toMatchObject({ sharedCaseId: incorrect, ratings: { incorrect: 1 }, notes: [{ rating: "incorrect" }] });
    expect(JSON.stringify(summary)).not.toMatch(new RegExp(Object.values(firmIds).join("|")));
  });

  it("takes a case reported as identifying out of retrieval at once and holds it for privacy review", async () => {
    const reported = await sharedIdFor("b2:outside.roof_coverings");
    const before = await searchSharedCases({ limit: 25, query: "slipped slates" });
    expect(before.cases.some((item) => item.id === reported)).toBe(true);
    expect(await recordCaseFeedback(members.f, reported, { rating: "identifying", note: "The description matches a house on our street." })).toMatchObject({ suspended: true });
    expect((await searchSharedCases({ limit: 25, query: "slipped slates" })).cases.some((item) => item.id === reported)).toBe(false);
    const admin = database.connect(database.adminUrl);
    expect((await admin.select({ status: learningCandidates.status }).from(learningCandidates).where(eq(learningCandidates.id, caseIds["b2:outside.roof_coverings"])))[0].status).toBe("quarantined");
    expect((await admin.select({ action: learningAuditLog.action, actor: learningAuditLog.actor }).from(learningAuditLog).where(eq(learningAuditLog.candidateId, caseIds["b2:outside.roof_coverings"])))).toContainEqual({ action: "case.retracted", actor: "learning_service" });
  });

  it("lets reviewers retract a case for correction or reject it outright", async () => {
    await expect(retractSharedCase(compliance, await sharedIdFor("b3:outside.roof_coverings"), { reason: "Not a reviewer role.", reviewAgain: true })).rejects.toMatchObject({ status: 403 });
    expect(await retractSharedCase(technical, await sharedIdFor("b3:outside.roof_coverings"), { reason: "Wording overstates the cause.", reviewAgain: true })).toMatchObject({ status: "awaiting_technical_review", sharedCasesRemoved: 1 });
    expect(await retractSharedCase(manager, await sharedIdFor("b3:outside.chimney_stacks"), { reason: "Duplicate of a seed case.", reviewAgain: false })).toMatchObject({ status: "rejected" });
    await expect(retractSharedCase(manager, await sharedIdFor("b3:outside.chimney_stacks"), { reason: "Duplicate of a seed case.", reviewAgain: false })).resolves.toMatchObject({ sharedCasesRemoved: 0 });
    const admin = database.connect(database.adminUrl);
    const items = await admin.select({ status: learningReleaseItems.status }).from(learningReleaseItems).where(eq(learningReleaseItems.candidateId, caseIds["b3:outside.roof_coverings"]));
    expect(items).toEqual([{ status: "retracted" }]);
  });

  it("evaluates the retrieval baseline on held-out firms and properties without leakage, using only evaluation-granted cases", async () => {
    await expect(runRetrievalEvaluation(privacy, { seed: "eval-1", testShare: 0.25, heldOutContributorShare: 0.25, testFromDate: null, segmentThresholds: { small: 5, large: 50 } })).rejects.toMatchObject({ status: 403 });
    const run = await runRetrievalEvaluation(manager, { seed: "eval-1", testShare: 0.25, heldOutContributorShare: 0.25, testFromDate: null, segmentThresholds: { small: 5, large: 50 } });
    expect(run.leakage).toEqual({ groups: [], contributors: [], retrievedFromTestProperty: 0 });
    expect(run.plan).toMatchObject({ excludedWithoutEvaluationGrant: 8, heldOutContributors: 1 });
    const plan = run.plan as { testCases: number; trainCases: number; reasons: Record<string, number> };
    // Which firm is held out depends on the seed and the (random) contributor keys; the smallest firm still has 5 included cases.
    expect(plan.testCases).toBeGreaterThanOrEqual(5);
    expect(plan.reasons.held_out_contributor).toBeGreaterThanOrEqual(5);
    const overall = (run.metrics as { overall: { testCases: number; answered: number; abstained: number; coverage: number; ratingAgreementAt1: number | null } }).overall;
    expect(overall.testCases).toBe(plan.testCases);
    expect(overall.answered + overall.abstained).toBe(overall.testCases);
    expect(overall.answered).toBeGreaterThan(0);
    await expect(database.connect(database.learningUrl).update(learningEvaluationRuns).set({ metrics: {} }).where(sql`true`)).rejects.toThrow();
  });

  it("keeps fine-tuning gated and counts only released cases from firms granting model training", async () => {
    const gate = await loadFineTuningGate();
    expect(gate.allowed).toBe(false);
    expect(gate.eligibleCases).toBe(8);
    expect(gate.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/No approved model provider/), expect.stringMatching(/No measured benefit/), expect.stringMatching(/minimum eligible corpus/)]));
    expect(gate.reasons.some((reason) => /baseline has not been evaluated/.test(reason))).toBe(false);
  });
});
