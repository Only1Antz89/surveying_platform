import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { contributorSegments, planEvaluationSplits, splitLeakage } from "@surveynt/learning/evaluation";
import { currentGrant, curateRelease, fineTuningGate, trainingEligibility, type ContributionScope, privacyDecisionSchema, releaseCriteriaSchema, releaseProblems, reviewedCaseProblems, SANITISER, sharedCaseFields, technicalDecisionSchema, type CurationItem, type PrivacyDecision, type ReviewedCase, type SanitisedCase, type TechnicalDecision } from "@surveynt/learning";
import { aiModelRegister, auditEvents, createDatabase, learningAuditLog, learningCaseFeedback, learningEvaluationRuns, learningCandidates, learningContributionGrants, learningPolicyVersions, learningReleaseItems, learningReleases, learningReviews, learningSanitisationRuns, learningWithdrawalRequests, sharedCases, sharedReleases, withTenant, type Database } from "@surveynt/db";
import type { PlatformRole } from "@surveynt/domain";
import { LearningError, loadProgramme } from "./learning";
import { learningDb, retractCandidateCases } from "./learning-pipeline";

// Platform side of shared learning. Separate roles review privacy, review the
// surveying content and manage releases; compliance owns the policy. Reviewers
// see sanitised output and pseudonymous contributor keys, never firm identity.

export type LearningOperator = { platformStaffId: string; role: PlatformRole };

export const canManageLearningPolicy = (role: PlatformRole) => role === "super_admin" || role === "compliance";
export const canViewLearning = (role: PlatformRole) => ["super_admin", "compliance", "privacy_reviewer", "technical_reviewer", "release_manager"].includes(role);

function adminDb() {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for platform administration.");
  return createDatabase(process.env.DATABASE_ADMIN_URL);
}

function requireLearningDb() {
  const db = learningDb();
  if (!db) throw new LearningError(503, "learning_not_configured", "The learning service connection (DATABASE_LEARNING_URL) is not configured.");
  return db;
}

const restrictedAudit = (db: Pick<Database, "insert">, operator: LearningOperator, action: string, values: { candidateId?: string; releaseId?: string; metadata?: Record<string, unknown> }) =>
  db.insert(learningAuditLog).values({ actorStaffId: operator.platformStaffId, actor: operator.role, action, candidateId: values.candidateId ?? null, releaseId: values.releaseId ?? null, metadata: values.metadata ?? {} });

// Policy versions.

export const policyInput = z.object({
  version: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,30}$/),
  summary: z.string().trim().min(20).max(4000),
  policyDocumentRef: z.string().trim().min(5).max(500),
  privacyAssessmentRef: z.string().trim().min(3).max(200).nullable(),
  releaseCriteria: z.record(z.string(), z.unknown()),
});

export async function loadPolicyVersions() {
  return adminDb().select().from(learningPolicyVersions).orderBy(desc(learningPolicyVersions.createdAt)).limit(50);
}

export async function savePolicyDraft(operator: LearningOperator, input: z.infer<typeof policyInput>, id?: string) {
  if (!canManageLearningPolicy(operator.role)) throw new LearningError(403, "forbidden", "Compliance or super-admin access is required.");
  const db = adminDb();
  const values = { version: input.version, summary: input.summary, policyDocumentRef: input.policyDocumentRef, privacyAssessmentRef: input.privacyAssessmentRef, releaseCriteria: input.releaseCriteria, updatedAt: new Date() };
  const [saved] = id
    ? await db.update(learningPolicyVersions).set(values).where(and(eq(learningPolicyVersions.id, id), eq(learningPolicyVersions.status, "draft"))).returning()
    : await db.insert(learningPolicyVersions).values(values).returning();
  if (!saved) throw new LearningError(409, "not_draft", "Only drafts can be edited.");
  await db.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: id ? "learning.policy_updated" : "learning.policy_drafted", resourceType: "learning_policy", resourceId: saved.id, metadata: { version: saved.version } });
  return saved;
}

/** Publishing needs a privacy assessment reference and complete release criteria. The previous version is retired. */
export async function publishPolicy(operator: LearningOperator, id: string) {
  if (!canManageLearningPolicy(operator.role)) throw new LearningError(403, "forbidden", "Compliance or super-admin access is required.");
  const db = adminDb();
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(learningPolicyVersions).where(eq(learningPolicyVersions.id, id)).limit(1);
    if (!draft || draft.status !== "draft") throw new LearningError(409, "not_draft", "Only drafts can be published.");
    if (!draft.privacyAssessmentRef) throw new LearningError(422, "privacy_assessment_required", "Record the approved privacy assessment reference before publishing.");
    const criteria = releaseCriteriaSchema.safeParse(draft.releaseCriteria);
    if (!criteria.success) throw new LearningError(422, "release_criteria_incomplete", `Release criteria are incomplete: ${criteria.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", ")}.`);
    await tx.update(learningPolicyVersions).set({ status: "retired", updatedAt: new Date() }).where(eq(learningPolicyVersions.status, "published"));
    const [published] = await tx.update(learningPolicyVersions).set({ status: "published", publishedAt: new Date(), publishedByStaffId: operator.platformStaffId, updatedAt: new Date() }).where(eq(learningPolicyVersions.id, id)).returning();
    await tx.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: "learning.policy_published", resourceType: "learning_policy", resourceId: id, metadata: { version: published.version } });
    return published;
  });
}

// Review queues.

const queueStatuses = { privacy: ["awaiting_privacy_review", "quarantined"], technical: ["awaiting_technical_review"] } as const;

export async function loadReviewQueue(stage: keyof typeof queueStatuses, limit = 50) {
  const db = learningDb();
  if (!db) return null;
  const candidates = await db.select({ id: learningCandidates.id, contributorKey: learningCandidates.contributorKey, elementRef: learningCandidates.elementRef, status: learningCandidates.status, statusReason: learningCandidates.statusReason, createdAt: learningCandidates.createdAt })
    .from(learningCandidates).where(inArray(learningCandidates.status, [...queueStatuses[stage]])).orderBy(asc(learningCandidates.createdAt)).limit(limit);
  const ids = candidates.map((item) => item.id);
  const runs = ids.length ? await db.select().from(learningSanitisationRuns).where(inArray(learningSanitisationRuns.candidateId, ids)).orderBy(desc(learningSanitisationRuns.createdAt)) : [];
  const reviews = ids.length ? await db.select({ candidateId: learningReviews.candidateId, stage: learningReviews.stage, decision: learningReviews.decision, reviewerStaffId: learningReviews.reviewerStaffId, note: learningReviews.note, createdAt: learningReviews.createdAt }).from(learningReviews).where(inArray(learningReviews.candidateId, ids)) : [];
  return candidates.map((item) => {
    const run = runs.find((entry) => entry.candidateId === item.id);
    return {
      id: item.id, contributor: item.contributorKey.slice(0, 8), elementRef: item.elementRef, status: item.status, statusReason: item.statusReason, createdAt: item.createdAt.toISOString(),
      sanitised: run?.output ?? null, findings: run?.findings ?? [], residualTerms: run?.residualTerms ?? [], flags: run?.flags ?? [], transformer: run?.transformer ?? null,
      reviews: reviews.filter((entry) => entry.candidateId === item.id).map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    };
  });
}

export async function loadQueueCounts() {
  const db = learningDb();
  if (!db) return null;
  const rows = await db.select({ status: learningCandidates.status, count: sql<number>`count(*)::int` }).from(learningCandidates).groupBy(learningCandidates.status);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

/** Pipeline step 4. Privacy reviewers only; approval needs every check, rejection a reason. */
export async function recordPrivacyDecision(operator: LearningOperator, candidateId: string, input: PrivacyDecision) {
  if (operator.role !== "privacy_reviewer") throw new LearningError(403, "forbidden", "Only privacy reviewers can make privacy decisions.");
  const parsed = privacyDecisionSchema.parse(input);
  const db = requireLearningDb();
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({ id: learningCandidates.id, status: learningCandidates.status }).from(learningCandidates).where(eq(learningCandidates.id, candidateId)).for("update").limit(1);
    if (!candidate) throw new LearningError(404, "not_found", "The candidate could not be found.");
    if (!(queueStatuses.privacy as readonly string[]).includes(candidate.status)) throw new LearningError(409, "not_awaiting_privacy_review", "This candidate is not awaiting privacy review.");
    await tx.insert(learningReviews).values({ candidateId, stage: "privacy", reviewerStaffId: operator.platformStaffId, decision: parsed.decision, checks: parsed.checks, note: parsed.note ?? null });
    const status = parsed.decision === "approved" ? "awaiting_technical_review" : "rejected";
    await tx.update(learningCandidates).set({ status, statusReason: parsed.decision === "rejected" ? `Privacy review: ${parsed.note}` : null, updatedAt: new Date() }).where(eq(learningCandidates.id, candidateId));
    await restrictedAudit(tx, operator, `privacy.${parsed.decision}`, { candidateId });
    return { status };
  });
}

export async function loadLearningConsole() {
  const programme = await loadProgramme(adminDb());
  const [policies, counts, privacyQueue, technicalQueue, releases, feedback, evaluations, fineTuning] = await Promise.all([loadPolicyVersions(), loadQueueCounts(), loadReviewQueue("privacy"), loadReviewQueue("technical"), loadReleases(), loadCaseFeedback(), loadEvaluationRuns(), loadFineTuningGate()]);
  return {
    programme: { active: programme.status.active, reasons: programme.status.reasons, policy: programme.policy },
    learningConfigured: Boolean(process.env.DATABASE_LEARNING_URL),
    policies: policies.map((row) => ({ id: row.id, version: row.version, status: row.status, summary: row.summary, policyDocumentRef: row.policyDocumentRef, privacyAssessmentRef: row.privacyAssessmentRef, releaseCriteria: row.releaseCriteria, publishedAt: row.publishedAt?.toISOString() ?? null })),
    counts,
    privacyQueue,
    technicalQueue,
    releases,
    feedback,
    evaluations,
    fineTuning,
  };
}

// L2: technical review, releases and activation.

/** Pipeline step 5. A technical reviewer writes the shared case; never the person who did the privacy review. */
export async function recordTechnicalDecision(operator: LearningOperator, candidateId: string, input: TechnicalDecision) {
  if (operator.role !== "technical_reviewer") throw new LearningError(403, "forbidden", "Only technical reviewers can make surveying review decisions.");
  const parsed = technicalDecisionSchema.parse(input);
  if (parsed.decision === "approved") {
    const leaks = reviewedCaseProblems(parsed.reviewed!);
    if (leaks.length) throw new LearningError(422, "identifiers_in_review", `The reviewed text still contains identifiers in: ${leaks.join(", ")}.`);
  }
  const db = requireLearningDb();
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({ id: learningCandidates.id, status: learningCandidates.status }).from(learningCandidates).where(eq(learningCandidates.id, candidateId)).for("update").limit(1);
    if (!candidate) throw new LearningError(404, "not_found", "The candidate could not be found.");
    if (candidate.status !== "awaiting_technical_review") throw new LearningError(409, "not_awaiting_technical_review", "This candidate is not awaiting technical review.");
    const [privacyReview] = await tx.select({ reviewer: learningReviews.reviewerStaffId }).from(learningReviews).where(and(eq(learningReviews.candidateId, candidateId), eq(learningReviews.stage, "privacy"))).limit(1);
    if (privacyReview?.reviewer === operator.platformStaffId) throw new LearningError(409, "separation_of_duties", "The privacy reviewer of a case cannot also review its content.");
    await tx.insert(learningReviews).values({ candidateId, stage: "technical", reviewerStaffId: operator.platformStaffId, decision: parsed.decision, reviewed: (parsed.reviewed ?? null) as Record<string, unknown> | null, note: parsed.note ?? null });
    const status = parsed.decision === "approved" ? "approved" : "rejected";
    await tx.update(learningCandidates).set({ status, statusReason: parsed.decision === "rejected" ? `Technical review: ${parsed.note}` : null, updatedAt: new Date() }).where(eq(learningCandidates.id, candidateId));
    await restrictedAudit(tx, operator, `technical.${parsed.decision}`, { candidateId });
    return { status };
  });
}

type StagedCase = { candidateId: string; organisationId: string; contributorKey: string; jobId: string; dedupKey: string; groupKey: string; status: string; sanitised: SanitisedCase; reviewed: ReviewedCase; reviewedAt: Date };

/**
 * Reviewed candidates with their latest sanitisation output and technical
 * review. By default every approved or already released case: a release
 * replaces the active one, so it carries the whole corpus forward.
 */
async function stagedCases(db: Database, candidateIds?: string[]): Promise<StagedCase[]> {
  const candidates = await db.select().from(learningCandidates).where(candidateIds ? inArray(learningCandidates.id, candidateIds) : inArray(learningCandidates.status, ["approved", "released"]));
  if (!candidates.length) return [];
  const ids = candidates.map((item) => item.id);
  const [runs, reviews] = await Promise.all([
    db.select().from(learningSanitisationRuns).where(inArray(learningSanitisationRuns.candidateId, ids)).orderBy(desc(learningSanitisationRuns.createdAt)),
    db.select().from(learningReviews).where(and(inArray(learningReviews.candidateId, ids), eq(learningReviews.stage, "technical"), eq(learningReviews.decision, "approved"))).orderBy(desc(learningReviews.createdAt)),
  ]);
  return candidates.flatMap((item) => {
    const run = runs.find((entry) => entry.candidateId === item.id);
    const review = reviews.find((entry) => entry.candidateId === item.id);
    if (!run || !review?.reviewed) return [];
    return [{ candidateId: item.id, organisationId: item.organisationId, contributorKey: item.contributorKey, jobId: item.jobId, dedupKey: item.dedupKey, groupKey: item.groupKey, status: item.status, sanitised: run.output as unknown as SanitisedCase, reviewed: review.reviewed as unknown as ReviewedCase, reviewedAt: review.createdAt }];
  });
}

/** Whether each contributing firm still grants a scope under the current policy, read through the tenant connection. */
async function rightsByCandidate(cases: Pick<StagedCase, "candidateId" | "organisationId" | "jobId">[], policyVersion: string, scope: ContributionScope = "structured_cases") {
  const app = createDatabase();
  const current = new Map<string, boolean>();
  for (const organisationId of new Set(cases.map((item) => item.organisationId))) {
    const [grants, withdrawals] = await withTenant(app, organisationId, (tx) => Promise.all([
      tx.select().from(learningContributionGrants).where(eq(learningContributionGrants.organisationId, organisationId)),
      tx.select({ scope: learningWithdrawalRequests.scope, jobId: learningWithdrawalRequests.jobId }).from(learningWithdrawalRequests).where(eq(learningWithdrawalRequests.organisationId, organisationId)),
    ]));
    const grant = currentGrant(grants, scope);
    for (const item of cases.filter((entry) => entry.organisationId === organisationId)) {
      const withdrawn = withdrawals.some((request) => request.jobId === item.jobId && (request.scope === null || request.scope === "structured_cases" || request.scope === scope));
      current.set(item.candidateId, grant?.status === "granted" && grant.policyVersion === policyVersion && !withdrawn);
    }
  }
  return current;
}

const expectedSegments = { jurisdiction: ["ENG", "WLS", "SCT", "NIR"], serviceLevel: ["level_1", "level_2", "level_3"] };

function curationItem(item: StagedCase): CurationItem {
  return {
    candidateId: item.candidateId, contributorKey: item.contributorKey, dedupKey: item.dedupKey, groupKey: item.groupKey, reviewedAt: item.reviewedAt.toISOString(),
    coverage: { jurisdiction: item.sanitised.jurisdiction, serviceLevel: item.sanitised.serviceLevel, propertyType: item.sanitised.property.propertyType, ageBand: item.sanitised.property.ageBand, elementKey: item.sanitised.elementKey, rating: item.reviewed.ratingExample ?? item.sanitised.conditionRating },
    uncertainty: item.reviewed.uncertainty, ratingDisagreement: item.reviewed.ratingDisagreement, noDefect: item.reviewed.noDefect,
  };
}

async function releaseCheck(db: Database, items: { candidateId: string }[]) {
  const programme = await loadProgramme(adminDb());
  if (!programme.status.active || !programme.status.criteria) throw new LearningError(409, "programme_inactive", "Shared learning is not active, so no release can be prepared or approved.");
  const cases = await stagedCases(db, items.map((item) => item.candidateId));
  const rights = await rightsByCandidate(cases, programme.status.policyVersion!);
  const curation = curateRelease(cases.map(curationItem), programme.status.criteria, expectedSegments);
  const states = items.map(({ candidateId }) => {
    const item = cases.find((entry) => entry.candidateId === candidateId);
    return { candidateId, privacyApproved: Boolean(item), technicalApproved: Boolean(item), rightsCurrent: rights.get(candidateId) ?? false, withdrawn: !item || item.status === "withdrawn" };
  });
  return { programme, cases, curation, problems: releaseProblems(curation, programme.status.criteria, states, { technicalAgreement: null }) };
}

/** Pipeline steps 6-7. Release managers curate every approved case into a draft with its manifest and problems. */
export async function createReleaseDraft(operator: LearningOperator, input: { version: string }) {
  if (operator.role !== "release_manager") throw new LearningError(403, "forbidden", "Only release managers can prepare releases.");
  const db = requireLearningDb();
  const approved = await stagedCases(db);
  const { programme, cases, curation, problems } = await releaseCheck(db, approved);
  const fresh = curation.included.filter((item) => cases.find((entry) => entry.candidateId === item.candidateId)?.status === "approved");
  if (!fresh.length) throw new LearningError(409, "nothing_to_release", "No newly approved cases would change the shared corpus.");
  const manifest = {
    version: input.version, policyVersion: programme.status.policyVersion, licenceScope: programme.status.criteria!.licenceScope, criteriaDefinedBy: programme.status.criteria!.definedBy,
    transformers: [SANITISER], ...curation.manifest, preparedAt: new Date().toISOString(),
  };
  return db.transaction(async (tx) => {
    const [release] = await tx.insert(learningReleases).values({ version: input.version, policyVersion: programme.status.policyVersion!, manifest, problems, createdByStaffId: operator.platformStaffId }).returning();
    if (curation.included.length) await tx.insert(learningReleaseItems).values(curation.included.map((item) => ({ releaseId: release.id, candidateId: item.candidateId, weight: item.weight })));
    await restrictedAudit(tx, operator, "release.drafted", { releaseId: release.id, metadata: { version: input.version, cases: curation.included.length, problems: problems.length } });
    return release;
  });
}

/** A privacy reviewer signs off the release as a whole, including linkage across earlier releases. */
export async function signOffReleasePrivacy(operator: LearningOperator, releaseId: string, note: string) {
  if (operator.role !== "privacy_reviewer") throw new LearningError(403, "forbidden", "Only privacy reviewers can sign off a release.");
  if (note.trim().length < 10) throw new LearningError(422, "note_required", "Record what was checked, including linkage across earlier releases.");
  const db = requireLearningDb();
  const [updated] = await db.update(learningReleases).set({ privacySignoffStaffId: operator.platformStaffId, privacySignoffAt: new Date(), privacyNote: note.trim(), updatedAt: new Date() }).where(and(eq(learningReleases.id, releaseId), eq(learningReleases.status, "draft"))).returning();
  if (!updated) throw new LearningError(409, "not_draft", "Only draft releases can be signed off.");
  await restrictedAudit(db, operator, "release.privacy_signed_off", { releaseId });
  return updated;
}

/** Approval re-checks every item (withdrawals, rights) and needs a different person's privacy sign-off. */
export async function approveRelease(operator: LearningOperator, releaseId: string) {
  if (operator.role !== "release_manager") throw new LearningError(403, "forbidden", "Only release managers can approve releases.");
  const db = requireLearningDb();
  const [release] = await db.select().from(learningReleases).where(eq(learningReleases.id, releaseId)).limit(1);
  if (!release || release.status !== "draft") throw new LearningError(409, "not_draft", "Only draft releases can be approved.");
  if (!release.privacySignoffStaffId) throw new LearningError(409, "privacy_signoff_required", "A privacy reviewer must sign off the release first.");
  if (release.privacySignoffStaffId === operator.platformStaffId) throw new LearningError(409, "separation_of_duties", "The privacy sign-off and the approval must be by different people.");
  const items = await db.select({ candidateId: learningReleaseItems.candidateId }).from(learningReleaseItems).where(and(eq(learningReleaseItems.releaseId, releaseId), eq(learningReleaseItems.status, "included")));
  const { problems } = await releaseCheck(db, items);
  if (problems.length) throw new LearningError(422, "release_problems", problems.join(" "));
  const [approved] = await db.update(learningReleases).set({ status: "approved", approvedByStaffId: operator.platformStaffId, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(learningReleases.id, releaseId), eq(learningReleases.status, "draft"))).returning();
  await restrictedAudit(db, operator, "release.approved", { releaseId });
  return approved;
}

const searchText = (fields: ReturnType<typeof sharedCaseFields>) => [fields.elementLabel, fields.observedFeature, fields.surveyorJudgement, ...fields.possibleCauses, ...fields.nextSteps, fields.limitations ?? ""].join(" ");

/**
 * Activates an approved release (or re-activates a superseded one on rollback):
 * one active release at a time, published to the shared schema atomically.
 */
export async function activateRelease(operator: LearningOperator, releaseId: string) {
  if (operator.role !== "release_manager") throw new LearningError(403, "forbidden", "Only release managers can activate releases.");
  const db = requireLearningDb();
  return db.transaction(async (tx) => {
    const [release] = await tx.select().from(learningReleases).where(eq(learningReleases.id, releaseId)).for("update").limit(1);
    if (!release || !["approved", "superseded"].includes(release.status)) throw new LearningError(409, "not_activatable", "Only approved or superseded releases can be activated.");
    const items = await tx.select().from(learningReleaseItems).where(and(eq(learningReleaseItems.releaseId, releaseId), eq(learningReleaseItems.status, "included")));
    await tx.update(learningReleases).set({ status: "superseded", updatedAt: new Date() }).where(eq(learningReleases.status, "active"));
    await tx.update(sharedReleases).set({ status: "inactive" }).where(eq(sharedReleases.status, "active"));
    const [existing] = await tx.select({ id: sharedReleases.id }).from(sharedReleases).where(eq(sharedReleases.id, releaseId)).limit(1);
    if (existing) await tx.update(sharedReleases).set({ status: "active", activatedAt: new Date() }).where(eq(sharedReleases.id, releaseId));
    else {
      const manifest = release.manifest as { coverage?: unknown; unsupportedSegments?: unknown };
      await tx.insert(sharedReleases).values({ id: releaseId, version: release.version, status: "active", caseCount: items.length, coverage: { coverage: manifest.coverage ?? {}, unsupportedSegments: manifest.unsupportedSegments ?? [] }, activatedAt: new Date() });
      const cases = await stagedCases(tx as unknown as Database, items.map((item) => item.candidateId));
      for (const item of items) {
        const staged = cases.find((entry) => entry.candidateId === item.candidateId);
        if (!staged) continue;
        const fields = sharedCaseFields(staged.sanitised, staged.reviewed);
        await tx.insert(sharedCases).values({ id: item.sharedCaseId, releaseId, ...fields, weight: item.weight, searchText: searchText(fields) });
      }
      if (items.length) await tx.update(learningCandidates).set({ status: "released", updatedAt: new Date() }).where(and(inArray(learningCandidates.id, items.map((item) => item.candidateId)), eq(learningCandidates.status, "approved")));
    }
    const [activated] = await tx.update(learningReleases).set({ status: "active", activatedByStaffId: operator.platformStaffId, activatedAt: new Date(), updatedAt: new Date() }).where(eq(learningReleases.id, releaseId)).returning();
    await restrictedAudit(tx, operator, release.status === "superseded" ? "release.reactivated" : "release.activated", { releaseId, metadata: { version: release.version, cases: items.length } });
    return activated;
  });
}

/** Rolls back to the most recently superseded release; the current one is marked rolled back. */
export async function rollbackRelease(operator: LearningOperator, reason: string) {
  if (operator.role !== "release_manager") throw new LearningError(403, "forbidden", "Only release managers can roll back releases.");
  if (reason.trim().length < 10) throw new LearningError(422, "reason_required", "Record why the release is rolled back.");
  const db = requireLearningDb();
  const [active] = await db.select().from(learningReleases).where(eq(learningReleases.status, "active")).limit(1);
  if (!active) throw new LearningError(409, "nothing_active", "No release is active.");
  const [previous] = await db.select().from(learningReleases).where(eq(learningReleases.status, "superseded")).orderBy(desc(learningReleases.activatedAt)).limit(1);
  await db.transaction(async (tx) => {
    await tx.update(learningReleases).set({ status: "rolled_back", updatedAt: new Date() }).where(eq(learningReleases.id, active.id));
    await tx.update(sharedReleases).set({ status: "inactive" }).where(eq(sharedReleases.id, active.id));
    await restrictedAudit(tx, operator, "release.rolled_back", { releaseId: active.id, metadata: { reason: reason.trim(), restored: previous?.version ?? null } });
  });
  return previous ? activateRelease(operator, previous.id) : null;
}

export async function loadReleases() {
  const db = learningDb();
  if (!db) return null;
  const releases = await db.select().from(learningReleases).orderBy(desc(learningReleases.createdAt)).limit(20);
  return releases.map((row) => ({ id: row.id, version: row.version, status: row.status, policyVersion: row.policyVersion, manifest: row.manifest, problems: row.problems, privacySignedOff: Boolean(row.privacySignoffAt), privacyNote: row.privacyNote, approvedAt: row.approvedAt?.toISOString() ?? null, activatedAt: row.activatedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }));
}

// L3: corrections, feedback and held-out evaluation.

/** Takes a released case out of every release; it can go back for review (a correction) or be rejected. */
export async function retractSharedCase(operator: LearningOperator, sharedCaseId: string, input: { reason: string; reviewAgain: boolean }) {
  if (!["release_manager", "privacy_reviewer", "technical_reviewer"].includes(operator.role)) throw new LearningError(403, "forbidden", "A reviewer or release manager role is required.");
  if (input.reason.trim().length < 10) throw new LearningError(422, "reason_required", "Record why the case is retracted.");
  const nextStatus = !input.reviewAgain ? "rejected" : operator.role === "privacy_reviewer" ? "quarantined" : "awaiting_technical_review";
  const result = await retractCandidateCases(requireLearningDb(), { sharedCaseId, reason: input.reason.trim(), nextStatus, actorStaffId: operator.platformStaffId, actor: operator.role });
  if (!result) throw new LearningError(404, "not_found", "The shared case could not be found.");
  return result;
}

/** Feedback from every firm, without firm identity: counts per case, and the notes behind problem reports. */
export async function loadCaseFeedback() {
  const db = adminDb();
  const [counts, notes] = await Promise.all([
    db.select({ sharedCaseId: learningCaseFeedback.sharedCaseId, releaseVersion: learningCaseFeedback.releaseVersion, rating: learningCaseFeedback.rating, count: sql<number>`count(*)::int` }).from(learningCaseFeedback).groupBy(learningCaseFeedback.sharedCaseId, learningCaseFeedback.releaseVersion, learningCaseFeedback.rating),
    db.select({ sharedCaseId: learningCaseFeedback.sharedCaseId, rating: learningCaseFeedback.rating, note: learningCaseFeedback.note, createdAt: learningCaseFeedback.createdAt }).from(learningCaseFeedback).where(inArray(learningCaseFeedback.rating, ["incorrect", "identifying"])).orderBy(desc(learningCaseFeedback.createdAt)).limit(100),
  ]);
  const byCase = new Map<string, { sharedCaseId: string; releaseVersion: string; ratings: Record<string, number>; notes: { rating: string; note: string | null; createdAt: string }[] }>();
  for (const row of counts) {
    const entry = byCase.get(row.sharedCaseId) ?? { sharedCaseId: row.sharedCaseId, releaseVersion: row.releaseVersion, ratings: {}, notes: [] };
    entry.ratings[row.rating] = (entry.ratings[row.rating] ?? 0) + Number(row.count);
    byCase.set(row.sharedCaseId, entry);
  }
  for (const row of notes) byCase.get(row.sharedCaseId)?.notes.push({ rating: row.rating, note: row.note, createdAt: row.createdAt.toISOString() });
  const priority = (entry: { ratings: Record<string, number> }) => (entry.ratings.identifying ?? 0) * 100 + (entry.ratings.incorrect ?? 0) * 10 + (entry.ratings.not_helpful ?? 0);
  return [...byCase.values()].sort((a, b) => priority(b) - priority(a)).slice(0, 50);
}

export const evaluationInput = z.object({
  seed: z.string().trim().min(3).max(60),
  testShare: z.number().min(0.05).max(0.5),
  heldOutContributorShare: z.number().min(0).max(0.5),
  testFromDate: z.iso.date().nullable(),
  segmentThresholds: z.object({ small: z.number().int().min(1), large: z.number().int().min(2) }),
});

/**
 * Held-out evaluation of the shared-retrieval baseline on the active release.
 * Only cases from firms that grant the evaluation scope are used as test cases;
 * every case from one property stays on one side; held-out firms are test-only.
 * For each test case the best-ranked training case for the same element is
 * retrieved, and its example rating compared. Nothing is trained.
 */
export async function runRetrievalEvaluation(operator: LearningOperator, input: z.infer<typeof evaluationInput>) {
  if (operator.role !== "release_manager" && operator.role !== "technical_reviewer") throw new LearningError(403, "forbidden", "A release manager or technical reviewer role is required.");
  const options = evaluationInput.parse(input);
  const db = requireLearningDb();
  const programme = await loadProgramme(adminDb());
  if (!programme.status.active) throw new LearningError(409, "programme_inactive", "Shared learning is not active.");
  const [release] = await db.select().from(learningReleases).where(eq(learningReleases.status, "active")).limit(1);
  if (!release) throw new LearningError(409, "nothing_active", "No release is active.");
  const rows = await db.select({ candidateId: learningCandidates.id, organisationId: learningCandidates.organisationId, jobId: learningCandidates.jobId, contributorKey: learningCandidates.contributorKey, groupKey: learningCandidates.groupKey, sharedCaseId: learningReleaseItems.sharedCaseId, elementKey: sharedCases.elementKey, observedFeature: sharedCases.observedFeature, ratingExample: sharedCases.ratingExample, reviewedAt: learningCandidates.createdAt })
    .from(learningReleaseItems).innerJoin(learningCandidates, eq(learningCandidates.id, learningReleaseItems.candidateId)).innerJoin(sharedCases, eq(sharedCases.id, learningReleaseItems.sharedCaseId))
    .where(and(eq(learningReleaseItems.releaseId, release.id), eq(learningReleaseItems.status, "included")));
  const evaluationRights = await rightsByCandidate(rows, programme.status.policyVersion!, "evaluation");
  const eligible = rows.filter((row) => evaluationRights.get(row.candidateId));
  const contributors = [...new Set(eligible.map((row) => row.contributorKey))].sort((a, b) => createHash("sha256").update(`${options.seed}:${a}`).digest("hex").localeCompare(createHash("sha256").update(`${options.seed}:${b}`).digest("hex")));
  const heldOut = contributors.slice(0, Math.floor(contributors.length * options.heldOutContributorShare));
  const splitItems = eligible.map((row) => ({ candidateId: row.candidateId, contributorKey: row.contributorKey, groupKey: row.groupKey, reviewedAt: row.reviewedAt.toISOString().slice(0, 10) }));
  const assignments = planEvaluationSplits(splitItems, { heldOutContributors: heldOut, testFromDate: options.testFromDate, testShare: options.testShare, seed: options.seed });
  const test = new Set(assignments.filter((item) => item.split === "test").map((item) => item.candidateId));
  // A property with any test case contributes nothing to the training side.
  const testGroups = new Set(rows.filter((row) => test.has(row.candidateId)).map((row) => row.groupKey));
  const heldOutSet = new Set(heldOut);
  const train = rows.filter((row) => !test.has(row.candidateId) && !testGroups.has(row.groupKey) && !heldOutSet.has(row.contributorKey));
  const leakage = { ...splitLeakage(splitItems, assignments, heldOut), retrievedFromTestProperty: 0 };
  const segments = contributorSegments(rows.reduce((all, row) => all.set(row.contributorKey, (all.get(row.contributorKey) ?? 0) + 1), new Map<string, number>()), options.segmentThresholds);
  const outcomes: { segment: string; answered: boolean; agreed: boolean }[] = [];
  const trainIds = train.map((row) => row.sharedCaseId);
  for (const row of rows.filter((entry) => test.has(entry.candidateId))) {
    const [best] = trainIds.length ? await db.select({ id: sharedCases.id, ratingExample: sharedCases.ratingExample }).from(sharedCases)
      .where(and(inArray(sharedCases.id, trainIds), eq(sharedCases.elementKey, row.elementKey), sql`${sharedCases.search} @@ plainto_tsquery('english', ${row.observedFeature})`))
      .orderBy(sql`ts_rank(${sharedCases.search}, plainto_tsquery('english', ${row.observedFeature})) desc`, sharedCases.id).limit(1) : [];
    if (best && testGroups.has(train.find((entry) => entry.sharedCaseId === best.id)?.groupKey ?? "")) leakage.retrievedFromTestProperty += 1;
    outcomes.push({ segment: segments.get(row.contributorKey) ?? "unknown", answered: Boolean(best), agreed: Boolean(best && best.ratingExample === row.ratingExample) });
  }
  const summarise = (items: typeof outcomes) => {
    const answered = items.filter((item) => item.answered).length;
    return { testCases: items.length, answered, abstained: items.length - answered, coverage: items.length ? answered / items.length : null, ratingAgreementAt1: answered ? items.filter((item) => item.agreed).length / answered : null };
  };
  const metrics = { overall: summarise(outcomes), bySegment: Object.fromEntries(["small", "medium", "large"].map((segment) => [segment, summarise(outcomes.filter((item) => item.segment === segment))])) };
  const plan = { testCases: test.size, trainCases: train.length, excludedWithoutEvaluationGrant: rows.length - eligible.length, heldOutContributors: heldOut.length, reasons: assignments.reduce<Record<string, number>>((all, item) => ({ ...all, [item.reason]: (all[item.reason] ?? 0) + 1 }), {}) };
  const [run] = await db.insert(learningEvaluationRuns).values({ releaseId: release.id, method: "retrieval-baseline-v1", options, plan, metrics, leakage, createdByStaffId: operator.platformStaffId }).returning();
  await restrictedAudit(db, operator, "evaluation.run", { releaseId: release.id, metadata: { runId: run.id, testCases: test.size } });
  return run;
}

export async function loadEvaluationRuns() {
  const db = learningDb();
  if (!db) return null;
  const runs = await db.select({ id: learningEvaluationRuns.id, method: learningEvaluationRuns.method, plan: learningEvaluationRuns.plan, metrics: learningEvaluationRuns.metrics, leakage: learningEvaluationRuns.leakage, createdAt: learningEvaluationRuns.createdAt, version: learningReleases.version })
    .from(learningEvaluationRuns).innerJoin(learningReleases, eq(learningReleases.id, learningEvaluationRuns.releaseId)).orderBy(desc(learningEvaluationRuns.createdAt)).limit(10);
  return runs.map((run) => ({ ...run, createdAt: run.createdAt.toISOString() }));
}

// L4: the fine-tuning gate. Reported, never acted on: nothing trains.

export async function loadFineTuningGate() {
  const db = learningDb();
  const [approvedModels] = await Promise.all([adminDb().select({ id: aiModelRegister.id }).from(aiModelRegister).where(eq(aiModelRegister.status, "approved")).limit(1)]);
  const programme = await loadProgramme(adminDb());
  let eligibleCases = 0;
  let evaluated = false;
  if (db && programme.status.policyVersion) {
    const released = await db.select({ candidateId: learningCandidates.id, organisationId: learningCandidates.organisationId, jobId: learningCandidates.jobId, status: learningCandidates.status, releaseVersion: learningReleases.version })
      .from(learningCandidates).innerJoin(learningReleaseItems, and(eq(learningReleaseItems.candidateId, learningCandidates.id), eq(learningReleaseItems.status, "included"))).innerJoin(learningReleases, eq(learningReleases.id, learningReleaseItems.releaseId))
      .where(eq(learningReleases.status, "active"));
    const rights = await rightsByCandidate(released, programme.status.policyVersion, "model_training");
    eligibleCases = released.filter((row) => trainingEligibility({ status: row.status, releasedIn: row.releaseVersion, modelTrainingGrant: rights.get(row.candidateId) ? { status: "granted", policyVersion: programme.status.policyVersion! } : null, currentPolicyVersion: programme.status.policyVersion }).eligible).length;
    evaluated = (await db.select({ id: learningEvaluationRuns.id }).from(learningEvaluationRuns).limit(1)).length > 0;
  }
  return { eligibleCases, ...fineTuningGate({ providerRegistered: approvedModels.length > 0, retrievalBaselineEvaluated: evaluated, specificFailuresIdentified: false, measuredBenefitOverBaseline: false, memorisationAndLeakageTestsPassed: false, retirementAndRetrainingProcedureApproved: false, eligibleCases, minimumEligibleCases: null }) };
}
