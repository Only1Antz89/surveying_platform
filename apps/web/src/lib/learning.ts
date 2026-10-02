import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { contributionConfirmations, contributionScopes, currentGrant, programmeStatus, type ContributionScope } from "@surveynt/learning";
import { auditEvents, createDatabase, jobs, learningContributionGrants, learningPolicyVersions, learningWithdrawalRequests, withTenant, type Database } from "@surveynt/db";
import { canManageTeam, canMutateOperations, type OrganisationRole } from "@surveynt/domain";
import { processWithdrawal } from "./learning-pipeline";

export type LearningContext = { organisationId: string; internalUserId: string | null; role: OrganisationRole };

export class LearningError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** The single published contribution policy, if any. Readable by every role. */
export async function loadPublishedPolicy(db: Database = createDatabase()) {
  const [policy] = await db.select().from(learningPolicyVersions).where(eq(learningPolicyVersions.status, "published")).limit(1);
  return policy ?? null;
}

export async function loadProgramme(db?: Database) {
  const policy = await loadPublishedPolicy(db);
  const status = programmeStatus(process.env, policy ? { version: policy.version, status: policy.status, privacyAssessmentRef: policy.privacyAssessmentRef, releaseCriteria: policy.releaseCriteria } : null);
  return { status, policy: policy ? { version: policy.version, summary: policy.summary, policyDocumentRef: policy.policyDocumentRef, publishedAt: policy.publishedAt?.toISOString() ?? null } : null };
}

/** The firm's view: its scopes, grants, withdrawal requests and counts. Never another firm's information. */
export async function loadLearningDashboard(context: Pick<LearningContext, "organisationId">) {
  const db = createDatabase();
  const programme = await loadProgramme(db);
  return withTenant(db, context.organisationId, async (tx) => {
    const [grants, withdrawals, summary] = await Promise.all([
      tx.select().from(learningContributionGrants).where(eq(learningContributionGrants.organisationId, context.organisationId)).orderBy(desc(learningContributionGrants.createdAt)).limit(100),
      tx.select({ id: learningWithdrawalRequests.id, scope: learningWithdrawalRequests.scope, jobId: learningWithdrawalRequests.jobId, jobReference: jobs.reference, reason: learningWithdrawalRequests.reason, status: learningWithdrawalRequests.status, outcome: learningWithdrawalRequests.outcome, createdAt: learningWithdrawalRequests.createdAt, completedAt: learningWithdrawalRequests.completedAt })
        .from(learningWithdrawalRequests).leftJoin(jobs, eq(jobs.id, learningWithdrawalRequests.jobId)).where(eq(learningWithdrawalRequests.organisationId, context.organisationId)).orderBy(desc(learningWithdrawalRequests.createdAt)).limit(50),
      tx.execute(sql`select scope, status, cases from public.learning_contribution_summary()`),
    ]);
    const grantViews = grants.map((row) => ({ id: row.id, scope: row.scope, status: row.status, policyVersion: row.policyVersion, confirmations: row.confirmations, basis: row.basis, createdAt: row.createdAt.toISOString() }));
    return {
      programme: { active: programme.status.active, reasons: programme.status.reasons, policy: programme.policy },
      scopes: contributionScopes.map((scope) => {
        const current = currentGrant(grantViews, scope);
        const view: { scope: ContributionScope; status: string; policyVersion: string | null; outdated: boolean; since: string | null } = { scope, status: current?.status ?? "not_granted", policyVersion: current?.policyVersion ?? null, outdated: Boolean(current?.status === "granted" && programme.policy && current.policyVersion !== programme.policy.version), since: current?.createdAt ?? null };
        return view;
      }),
      grants: grantViews,
      withdrawals: withdrawals.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })),
      counts: (summary as unknown as { rows: { scope: string; status: string; cases: number }[] }).rows,
    };
  });
}

export const grantInput = z.object({
  scope: z.enum(contributionScopes),
  status: z.enum(["granted", "revoked"]),
  confirmations: z.array(z.enum(contributionConfirmations)).max(contributionConfirmations.length),
  basis: z.string().trim().max(1000).nullable(),
}).refine((input) => input.status === "revoked" || contributionConfirmations.every((item) => input.confirmations.includes(item)), { message: "Confirm each statement before granting.", path: ["confirmations"] })
  .refine((input) => input.status === "revoked" || (input.basis?.length ?? 0) >= 10, { message: "Record where your authority to contribute is set out (for example the clause in your terms of engagement).", path: ["basis"] });

/**
 * Owners and administrators grant or revoke one scope. Granting needs an
 * active programme; revoking always works and withdraws that scope at once.
 */
export async function recordContributionGrant(context: LearningContext, input: z.infer<typeof grantInput>) {
  if (!canManageTeam(context.role)) throw new LearningError(403, "forbidden", "Only owners and administrators can change contribution settings.");
  const db = createDatabase();
  const programme = await loadProgramme(db);
  if (input.status === "granted" && !programme.status.active) throw new LearningError(409, "programme_inactive", `Shared learning is not active, so contribution cannot be turned on. ${programme.status.reasons.map((reason) => reason.message).join(" ")}`);
  const { grant, withdrawalId } = await withTenant(db, context.organisationId, async (tx) => {
    const history = await tx.select().from(learningContributionGrants).where(eq(learningContributionGrants.organisationId, context.organisationId));
    const current = currentGrant(history, input.scope);
    if (input.status === "revoked" && current?.status !== "granted") throw new LearningError(409, "not_granted", "This scope is not currently granted.");
    const [grant] = await tx.insert(learningContributionGrants).values({
      organisationId: context.organisationId, scope: input.scope, status: input.status,
      policyVersion: input.status === "granted" ? programme.status.policyVersion! : current!.policyVersion,
      confirmations: input.status === "granted" ? input.confirmations : [], basis: input.status === "granted" ? input.basis : null, recordedByUserId: context.internalUserId,
    }).returning();
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: `learning.scope_${input.status}`, resourceType: "learning_scope", resourceId: input.scope, metadata: { policyVersion: grant.policyVersion } });
    if (input.status !== "revoked") return { grant, withdrawalId: null };
    const [request] = await tx.insert(learningWithdrawalRequests).values({ organisationId: context.organisationId, scope: input.scope, reason: "Scope revoked by the firm.", requestedByUserId: context.internalUserId }).returning({ id: learningWithdrawalRequests.id });
    return { grant, withdrawalId: request.id };
  });
  const withdrawal = withdrawalId ? await processWithdrawal(context.organisationId, withdrawalId) : null;
  return { grant, withdrawal };
}

export const withdrawalInput = z.object({
  scope: z.enum(contributionScopes).nullable(),
  jobId: z.uuid().nullable(),
  reason: z.string().trim().min(5).max(1000),
});

/** Anyone who can edit records can withdraw a job (for example on a client's objection) or a scope. Processed at once when possible. */
export async function requestWithdrawal(context: LearningContext, input: z.infer<typeof withdrawalInput>) {
  if (!canMutateOperations(context.role)) throw new LearningError(403, "forbidden", "Your role cannot request withdrawal.");
  const request = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    if (input.jobId) {
      const [job] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
      if (!job) throw new LearningError(404, "job_not_found", "The job could not be found.");
    }
    const [created] = await tx.insert(learningWithdrawalRequests).values({ organisationId: context.organisationId, scope: input.scope, jobId: input.jobId, reason: input.reason, requestedByUserId: context.internalUserId }).returning();
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "learning.withdrawal_requested", resourceType: "learning_withdrawal", resourceId: created.id, metadata: { scope: input.scope, jobId: input.jobId } });
    return created;
  });
  return { request, processed: await processWithdrawal(context.organisationId, request.id) };
}

export const scopeIsKnown = (value: string): value is ContributionScope => (contributionScopes as readonly string[]).includes(value);
