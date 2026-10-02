import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  clients, createDatabase, jobs, learningCandidates, learningContributionGrants, learningContributors, learningPolicyVersions, learningReleaseItems, learningReleases, learningReviews,
  learningSanitisationRuns, learningWithdrawalRequests, organisations, platformStaff, properties, sharedCases, sharedReleases, withTenant,
} from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import type { ReleaseCriteria, ReviewedCase, SanitisedCase } from "@surveynt/learning";
import { activateRelease, approveRelease, createReleaseDraft, recordTechnicalDecision, rollbackRelease, signOffReleasePrivacy, type LearningOperator } from "../src/lib/learning-admin";
import { processWithdrawal } from "../src/lib/learning-pipeline";
import { searchSharedCases } from "../src/lib/shared-cases";

// Synthetic reviewed candidates for three firms, seeded straight into restricted
// staging (extraction and privacy review are covered by learning.integration.test.ts).
const firms = { a: "00000000-0000-0000-0000-0000000000ae", b: "00000000-0000-0000-0000-0000000000be", c: "00000000-0000-0000-0000-0000000000ce", d: "00000000-0000-0000-0000-0000000000de" };
const criteria: ReleaseCriteria = { definedBy: "Synthetic test panel", minimumCasesPerRelease: 3, maxContributorShare: 0.5, rareCombinationReviewBelow: 2, minimumTechnicalAgreement: null, coverageDimensions: ["jurisdiction", "serviceLevel", "elementKey"], licenceScope: "Shared retrieval inside Surveynt only; no publication." };
const confirmations = ["client_information_authority", "third_party_rights", "policy_accepted"];

const sanitised = (elementKey: string, label: string, rating: string): SanitisedCase => ({
  jurisdiction: "ENG", serviceLevel: "level_2", template: "surveynt-residential@1", property: { propertyType: "house", builtForm: "mid_terrace", ageBand: "1919_1944", storeys: "2" },
  elementKey, elementLabel: label, inspectionStatus: "inspected", limitation: null, conditionRating: rating, nextActions: [],
  text: { construction: "Pitched slate roof.", surveyorObservations: ["Slipped slates."], clientStatements: [], recordContext: [], commentary: null, limitations: null }, photoCount: 0,
});
const reviewed = (feature: string, overrides: Partial<ReviewedCase> = {}): ReviewedCase => ({
  observedFeature: feature, possibleCauses: ["Nail fatigue"], confirmedCause: null, confirmationBasis: null, surveyorJudgement: "Repairs are needed soon but are not urgent.", ratingExample: "2",
  nextSteps: ["Ask a roofer to refix the slates"], limitations: null, uncertainty: "medium", evidenceStrength: "observed", knowledgeReviewDue: "2029-01-01", ratingDisagreement: false, noDefect: false, ...overrides,
});

describe.skipIf(!integrationEnabled)("shared learning releases and retrieval", () => {
  let database: TestDatabase;
  let privacy: LearningOperator;
  let technical: LearningOperator;
  let manager: LearningOperator;
  const jobsByFirm: Record<string, string> = {};
  const candidates: Record<string, string> = {};

  async function seedCandidate(name: string, firm: keyof typeof firms, dedupKey: string, content: SanitisedCase) {
    const learning = database.connect(database.learningUrl);
    await learning.insert(learningContributors).values({ organisationId: firms[firm] }).onConflictDoNothing();
    const [contributor] = await learning.select().from(learningContributors).where(eq(learningContributors.organisationId, firms[firm]));
    const [candidate] = await learning.insert(learningCandidates).values({
      organisationId: firms[firm], contributorKey: contributor.contributorKey, jobId: jobsByFirm[firm], surveyId: jobsByFirm[firm], elementId: crypto.randomUUID(), elementRef: content.elementKey,
      scope: "structured_cases", grantId: crypto.randomUUID(), policyVersion: "2027-01", sourceFingerprint: `synthetic:${name}`, dedupKey, groupKey: dedupKey.split("|")[0], content: { synthetic: true }, status: "awaiting_technical_review",
    }).returning();
    await learning.insert(learningSanitisationRuns).values({ candidateId: candidate.id, transformer: "sanitiser-v1", output: content as unknown as Record<string, unknown>, quasiKey: name, outcome: "passed" });
    await learning.insert(learningReviews).values({ candidateId: candidate.id, stage: "privacy", reviewerStaffId: privacy.platformStaffId, decision: "approved", checks: ["identifiers_removed"] });
    candidates[name] = candidate.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, DATABASE_LEARNING_URL: database.learningUrl, LEARNING_LINEAGE_SECRET: "synthetic-lineage-secret-for-tests-only-0002", SHARED_LEARNING_ENABLED: "true", ASSISTANT_ENABLED: "true" });
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values(Object.entries(firms).map(([key, id]) => ({ id, clerkOrganisationId: `org_${key}e`, name: `Firm ${key.toUpperCase()}`, slug: `firm-${key}e`, practiceType: "residential", region: "Bristol" })));
    for (const [key, organisationId] of Object.entries(firms)) {
      const [client] = await admin.insert(clients).values({ organisationId, kind: "individual", displayName: `Client ${key}` }).returning();
      const [property] = await admin.insert(properties).values({ organisationId, clientId: client.id, line1: `${key} Release Road`, city: "Bristol", postcode: "BS1 1AA", country: "ENG" }).returning();
      const [job] = await admin.insert(jobs).values({ organisationId, clientId: client.id, propertyId: property.id, reference: `REL-${key}`, serviceName: "Condition report" }).returning();
      jobsByFirm[key] = job.id;
      if (key !== "d") await admin.insert(learningContributionGrants).values({ organisationId, scope: "structured_cases", status: "granted", policyVersion: "2027-01", confirmations, basis: "Clause 12 of our terms of engagement." });
    }
    await admin.insert(learningPolicyVersions).values({ version: "2027-01", status: "published", summary: "Synthetic policy for release tests.", policyDocumentRef: "docs/shared-learning/policy.md", privacyAssessmentRef: "DPIA-SYNTHETIC-2", releaseCriteria: criteria, publishedAt: new Date() });
    const staff = await admin.insert(platformStaff).values([{ clerkUserId: "user_le_privacy", role: "privacy_reviewer" }, { clerkUserId: "user_le_technical", role: "technical_reviewer" }, { clerkUserId: "user_le_manager", role: "release_manager" }]).returning();
    privacy = { platformStaffId: staff[0].id, role: "privacy_reviewer" };
    technical = { platformStaffId: staff[1].id, role: "technical_reviewer" };
    manager = { platformStaffId: staff[2].id, role: "release_manager" };
    await seedCandidate("a1", "a", "pa1|roof", sanitised("outside.roof_coverings", "Roof coverings", "2"));
    await seedCandidate("a2", "a", "pa2|roof", sanitised("outside.roof_coverings", "Roof coverings", "2"));
    await seedCandidate("a3", "a", "pa3|chimney", sanitised("outside.chimney_stacks", "Chimney stacks", "3"));
    await seedCandidate("a4", "a", "pa1|roof", sanitised("outside.roof_coverings", "Roof coverings", "2"));
    await seedCandidate("b1", "b", "pb1|roof", sanitised("outside.roof_coverings", "Roof coverings", "1"));
    await seedCandidate("c1", "c", "pc1|roof", sanitised("outside.roof_coverings", "Roof coverings", "2"));
  }, 120_000);

  afterAll(async () => {
    delete process.env.SHARED_LEARNING_ENABLED;
    delete process.env.ASSISTANT_ENABLED;
    await database?.drop();
    await stopRelay();
  });

  it("lets technical reviewers write the shared case, separately from the privacy reviewer and without identifiers", async () => {
    await expect(recordTechnicalDecision(privacy, candidates.a1, { decision: "approved", reviewed: reviewed("Several slipped slates to a rear roof pitch.") })).rejects.toMatchObject({ status: 403 });
    await expect(recordTechnicalDecision({ ...privacy, role: "technical_reviewer" }, candidates.a1, { decision: "approved", reviewed: reviewed("Several slipped slates to a rear roof pitch.") })).rejects.toMatchObject({ code: "separation_of_duties" });
    await expect(recordTechnicalDecision(technical, candidates.a1, { decision: "approved", reviewed: reviewed("Slipped slates; call 07700 900123 for access.") })).rejects.toMatchObject({ code: "identifiers_in_review" });
    await expect(recordTechnicalDecision(technical, candidates.a1, { decision: "approved", reviewed: reviewed("Slipped slates to a rear pitch.", { confirmedCause: "Replaced in 2015", confirmationBasis: null }) })).rejects.toThrow();
    const features: Record<string, ReviewedCase> = {
      a1: reviewed("Several slipped slates to a rear slate roof pitch."), a2: reviewed("Cracked slates near the ridge of a slate roof."),
      a3: reviewed("Chimney stack leaning with open mortar joints.", { ratingExample: "3", nextSteps: ["Arrange a structural engineer's inspection"], uncertainty: "high" }),
      a4: reviewed("Slipped slates noted again on a later survey of the same roof."), b1: reviewed("Slate roof in reasonable condition with no defects seen.", { ratingExample: "1", possibleCauses: [], nextSteps: [], noDefect: true }),
      c1: reviewed("Moss growth and a few lifted slates on a north-facing slope.", { ratingDisagreement: true }),
    };
    for (const [name, value] of Object.entries(features)) expect(await recordTechnicalDecision(technical, candidates[name], { decision: "approved", reviewed: value })).toEqual({ status: "approved" });
    await expect(recordTechnicalDecision(technical, candidates.a1, { decision: "approved", reviewed: features.a1 })).rejects.toMatchObject({ code: "not_awaiting_technical_review" });
  });

  it("curates a balanced draft and approves only after a separate privacy sign-off and a fresh rights check", async () => {
    await expect(createReleaseDraft(technical, { version: "2027.1" })).rejects.toMatchObject({ status: 403 });
    const draft = await createReleaseDraft(manager, { version: "2027.1" });
    expect(draft.problems).toEqual([]);
    expect(draft.manifest).toMatchObject({ caseCount: 5, contributorCount: 3, duplicatesRemoved: 1, capFeasible: true, noDefectCases: 1, disagreementCases: 1, highUncertaintyCases: 1, policyVersion: "2027-01", licenceScope: criteria.licenceScope });
    expect(draft.manifest.maxEffectiveShare as number).toBeLessThanOrEqual(0.5);
    expect(draft.manifest.unsupportedSegments).toEqual(expect.arrayContaining(["jurisdiction=WLS", "jurisdiction=SCT", "jurisdiction=NIR", "serviceLevel=level_1", "serviceLevel=level_3"]));
    expect(JSON.stringify(draft.manifest)).not.toMatch(new RegExp(Object.values(firms).join("|")));

    await expect(approveRelease(manager, draft.id)).rejects.toMatchObject({ code: "privacy_signoff_required" });
    await expect(signOffReleasePrivacy(manager, draft.id, "Checked linkage.")).rejects.toMatchObject({ status: 403 });
    await signOffReleasePrivacy(privacy, draft.id, "Checked linkage against listings, planning records and the empty earlier releases.");
    await expect(approveRelease({ ...privacy, role: "release_manager" }, draft.id)).rejects.toMatchObject({ code: "separation_of_duties" });

    // Firm C withdraws its job after the draft: approval re-checks rights and refuses until the withdrawal is processed.
    const admin = database.connect(database.adminUrl);
    const [request] = await admin.insert(learningWithdrawalRequests).values({ organisationId: firms.c, jobId: jobsByFirm.c, reason: "Client objected after drafting." }).returning();
    await expect(approveRelease(manager, draft.id)).rejects.toMatchObject({ code: "release_problems", message: expect.stringMatching(/no longer has a current contribution grant/) });
    expect(await processWithdrawal(firms.c, request.id)).toMatchObject({ status: "completed", candidatesWithdrawn: 1, sharedCasesRemoved: 0 });
    expect((await admin.select().from(learningReleaseItems).where(eq(learningReleaseItems.candidateId, candidates.c1)))[0]).toMatchObject({ status: "withdrawn" });
    expect(await approveRelease(manager, draft.id)).toMatchObject({ status: "approved" });
    await expect(admin.update(learningReleases).set({ manifest: {} }).where(eq(learningReleases.id, draft.id))).rejects.toThrow();
  });

  it("publishes only the active release, identically for every firm, with no lineage", async () => {
    const programmeOff = await (async () => { delete process.env.SHARED_LEARNING_ENABLED; const result = await searchSharedCases({}); process.env.SHARED_LEARNING_ENABLED = "true"; return result; })();
    expect(programmeOff).toMatchObject({ available: false, cases: [] });
    expect(await searchSharedCases({})).toMatchObject({ available: true, release: null, cases: [] });
    const [draft] = await database.connect(database.adminUrl).select().from(learningReleases).where(eq(learningReleases.version, "2027.1"));
    await activateRelease(manager, draft.id);

    const all = await searchSharedCases({ limit: 25 });
    expect(all.release).toMatchObject({ version: "2027.1" });
    expect(all.cases).toHaveLength(4);
    expect(all.cases.every((item) => item.reference.startsWith("Shared case ") && item.reference.endsWith("release 2027.1"))).toBe(true);
    expect((await searchSharedCases({ query: "chimney leaning" })).cases.map((item) => item.elementKey)).toEqual(["outside.chimney_stacks"]);
    expect((await searchSharedCases({ elementKey: "outside.roof_coverings" })).cases).toHaveLength(3);
    expect((await searchSharedCases({ jurisdiction: "WLS" })).cases).toEqual([]);

    const admin = database.connect(database.adminUrl);
    const columns = await admin.execute(sql`select table_name, column_name from information_schema.columns where table_schema = 'learning_shared'`);
    expect((columns as unknown as { rows: { column_name: string }[] }).rows.map((row) => row.column_name)).not.toEqual(expect.arrayContaining(["organisation_id"]));
    const lineage = ["organisation_id", "contributor_key", "candidate_id", "job_id", "survey_id", "element_id", "property_id", "uprn", "dedup_key", "group_key", "source_fingerprint"];
    expect((columns as unknown as { rows: { column_name: string }[] }).rows.filter((row) => lineage.includes(row.column_name))).toEqual([]);
    expect((await admin.select({ status: learningCandidates.status }).from(learningCandidates).where(inArray(learningCandidates.id, [candidates.a4, candidates.b1, candidates.a1]))).map((row) => row.status).sort()).toEqual(["approved", "released", "released"]);

    // The tenant role reads, for every firm alike, and cannot write.
    const app = createDatabase(database.appUrl);
    const seenByD = await withTenant(app, firms.d, (tx) => tx.select({ id: sharedCases.id }).from(sharedCases));
    const seenByA = await withTenant(app, firms.a, (tx) => tx.select({ id: sharedCases.id }).from(sharedCases));
    expect(seenByD.map((row) => row.id).sort()).toEqual(seenByA.map((row) => row.id).sort());
    expect(seenByD).toHaveLength(4);
    await expect(app.delete(sharedCases).where(sql`true`)).rejects.toThrow();
    await expect(app.insert(sharedReleases).values({ id: crypto.randomUUID(), version: "rogue", status: "active", caseCount: 0 })).rejects.toThrow();
    await expect(app.execute(sql`select * from learning_restricted.release_items`)).rejects.toThrow();
  });

  it("replaces the corpus with each release and rolls back to the previous one", async () => {
    const admin = database.connect(database.adminUrl);
    const learning = database.connect(database.learningUrl);
    await expect(createReleaseDraft(manager, { version: "2027.2" })).rejects.toMatchObject({ code: "nothing_to_release" });
    const [b1] = await learning.select().from(learningCandidates).where(eq(learningCandidates.id, candidates.b1));
    const [b2] = await learning.insert(learningCandidates).values({ ...b1, id: undefined, sourceFingerprint: "synthetic:b2", dedupKey: "pb2|roof", groupKey: "pb2", status: "awaiting_technical_review", createdAt: undefined, updatedAt: undefined }).returning();
    await learning.insert(learningSanitisationRuns).values({ candidateId: b2.id, transformer: "sanitiser-v1", output: sanitised("outside.roof_coverings", "Roof coverings", "2") as unknown as Record<string, unknown>, quasiKey: "b2", outcome: "passed" });
    await recordTechnicalDecision(technical, b2.id, { decision: "approved", reviewed: reviewed("Ridge tiles loose along part of a slate roof.") });

    const second = await createReleaseDraft(manager, { version: "2027.2" });
    expect(second.manifest).toMatchObject({ caseCount: 5, contributorCount: 2 });
    await signOffReleasePrivacy(privacy, second.id, "Checked linkage including against release 2027.1.");
    await approveRelease(manager, second.id);
    await activateRelease(manager, second.id);
    expect((await searchSharedCases({ limit: 25 }))).toMatchObject({ release: { version: "2027.2" } });
    expect((await searchSharedCases({ limit: 25 })).cases).toHaveLength(5);
    const statuses = Object.fromEntries((await admin.select({ version: learningReleases.version, status: learningReleases.status }).from(learningReleases)).map((row) => [row.version, row.status]));
    expect(statuses).toEqual({ "2027.1": "superseded", "2027.2": "active" });

    await expect(rollbackRelease(manager, "short")).rejects.toMatchObject({ code: "reason_required" });
    await rollbackRelease(manager, "Reviewer feedback found a wording problem in 2027.2.");
    expect((await searchSharedCases({ limit: 25 }))).toMatchObject({ release: { version: "2027.1" } });
    expect((await searchSharedCases({ limit: 25 })).cases).toHaveLength(4);
    const app = createDatabase(database.appUrl);
    expect(await app.select().from(sharedCases).where(eq(sharedCases.releaseId, second.id))).toEqual([]);
  });

  it("removes a withdrawing firm's released cases from every release at once", async () => {
    const admin = database.connect(database.adminUrl);
    const [request] = await withTenant(createDatabase(database.appUrl), firms.a, (tx) => tx.insert(learningWithdrawalRequests).values({ organisationId: firms.a, reason: "Firm leaving shared learning." }).returning());
    const outcome = await processWithdrawal(firms.a, request.id);
    expect(outcome).toMatchObject({ status: "completed", candidatesWithdrawn: 4, sharedCasesRemoved: 6 });
    const remaining = await searchSharedCases({ limit: 25 });
    expect(remaining.cases.map((item) => item.observedFeature)).toEqual(["Slate roof in reasonable condition with no defects seen."]);
    expect((await admin.select({ caseCount: sharedReleases.caseCount }).from(sharedReleases).where(eq(sharedReleases.version, "2027.1")))[0].caseCount).toBe(1);
    const items = await admin.select({ status: learningReleaseItems.status }).from(learningReleaseItems).where(inArray(learningReleaseItems.candidateId, [candidates.a1, candidates.a2, candidates.a3]));
    expect(new Set(items.map((item) => item.status))).toEqual(new Set(["withdrawn"]));
  });
});
