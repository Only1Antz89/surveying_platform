import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { privacyDecisionSchema, releaseCriteriaSchema, type PrivacyDecision } from "@surveynt/learning";
import { auditEvents, createDatabase, learningAuditLog, learningCandidates, learningPolicyVersions, learningReviews, learningSanitisationRuns, type Database } from "@surveynt/db";
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
  const [policies, counts, privacyQueue] = await Promise.all([loadPolicyVersions(), loadQueueCounts(), loadReviewQueue("privacy")]);
  return {
    programme: { active: programme.status.active, reasons: programme.status.reasons, policy: programme.policy },
    learningConfigured: Boolean(process.env.DATABASE_LEARNING_URL),
    policies: policies.map((row) => ({ id: row.id, version: row.version, status: row.status, summary: row.summary, policyDocumentRef: row.policyDocumentRef, privacyAssessmentRef: row.privacyAssessmentRef, releaseCriteria: row.releaseCriteria, publishedAt: row.publishedAt?.toISOString() ?? null })),
    counts,
    privacyQueue,
  };
}
