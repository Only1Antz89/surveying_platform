import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { currentGrant, curateRelease, privacyDecisionSchema, releaseCriteriaSchema, releaseProblems, reviewedCaseProblems, SANITISER, sharedCaseFields, technicalDecisionSchema, type CurationItem, type PrivacyDecision, type ReviewedCase, type SanitisedCase, type TechnicalDecision } from "@surveynt/learning";
import { auditEvents, createDatabase, learningAuditLog, learningCandidates, learningContributionGrants, learningPolicyVersions, learningReleaseItems, learningReleases, learningReviews, learningSanitisationRuns, learningWithdrawalRequests, sharedCases, sharedReleases, withTenant, type Database } from "@surveynt/db";
import type { PlatformRole } from "@surveynt/domain";
import { LearningError, loadProgramme } from "./learning";
import { learningDb } from "./learning-pipeline";

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
  const [policies, counts, privacyQueue, technicalQueue, releases] = await Promise.all([loadPolicyVersions(), loadQueueCounts(), loadReviewQueue("privacy"), loadReviewQueue("technical"), loadReleases()]);
  return {
    programme: { active: programme.status.active, reasons: programme.status.reasons, policy: programme.policy },
    learningConfigured: Boolean(process.env.DATABASE_LEARNING_URL),
    policies: policies.map((row) => ({ id: row.id, version: row.version, status: row.status, summary: row.summary, policyDocumentRef: row.policyDocumentRef, privacyAssessmentRef: row.privacyAssessmentRef, releaseCriteria: row.releaseCriteria, publishedAt: row.publishedAt?.toISOString() ?? null })),
    counts,
    privacyQueue,
    technicalQueue,
    releases,
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

/** Whether each contributing firm still grants structured cases under the current policy, read through the tenant connection. */
async function rightsByCandidate(cases: StagedCase[], policyVersion: string) {
  const app = createDatabase();
  const current = new Map<string, boolean>();
  for (const organisationId of new Set(cases.map((item) => item.organisationId))) {
    const [grants, withdrawals] = await withTenant(app, organisationId, (tx) => Promise.all([
      tx.select().from(learningContributionGrants).where(eq(learningContributionGrants.organisationId, organisationId)),
      tx.select({ scope: learningWithdrawalRequests.scope, jobId: learningWithdrawalRequests.jobId }).from(learningWithdrawalRequests).where(eq(learningWithdrawalRequests.organisationId, organisationId)),
    ]));
    const grant = currentGrant(grants, "structured_cases");
    for (const item of cases.filter((entry) => entry.organisationId === organisationId)) {
      const withdrawn = withdrawals.some((request) => request.jobId === item.jobId && (request.scope === null || request.scope === "structured_cases"));
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
