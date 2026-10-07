import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { auditEvents, createDatabase, jobs, jobRetentionHolds, organisationMemberships, surveyFileRemovals, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok, parseBody, problem } from "@/lib/api";
import { readSurveyFileRetention } from "@/lib/survey-file-retention-register";

const input = z.object({ reviewVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), noUnresolvedComplaintOrClaim: z.literal(true), confirmed: z.literal(true) }).strict();
const holdInput = z.object({ expectedRevision: z.number().int().min(0), kind: z.enum(["complaint", "claim", "legal"]).nullable(), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
export async function PATCH(request: Request, route: RouteContext<"/api/v1/jobs/[id]/retention">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Sign in to review a job hold.");
  const denial = await workspaceApiGuard(request, context); if (denial) return denial;
  if (!isManagementRole(context.role) || !canWriteWorkspace(context)) return problem(403, "forbidden", "Practice management access is required.");
  const parsed = await parseBody(request, holdInput); if (!parsed.success) return problem(400, "invalid_request", "Review the hold, record a reason and confirm the change.");
  if (context.demo) return ok({ persisted: false });
  const { id } = await route.params; if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "Job not found.");
  return withTenant(createDatabase(), context.organisationId, async tx => {
    const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, context.internalUserId!), eq(organisationMemberships.active, true))).for("share");
    if (!member || member.role !== context.role || !isManagementRole(member.role)) return problem(403, "forbidden", "Your hold review permission changed.");
    // All hold decisions lock the job, including the first insert with no hold row yet.
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, context.organisationId), eq(jobs.id, id))).for("update");
    if (!job) return problem(404, "not_found", "Job not found.");
    const [previous] = await tx.select().from(jobRetentionHolds).where(and(eq(jobRetentionHolds.organisationId, context.organisationId), eq(jobRetentionHolds.jobId, id))).for("update");
    if ((previous?.revision ?? 0) !== parsed.data.expectedRevision) return problem(409, "hold_changed", "Reload and review the current job hold.");
    const next = { kind: parsed.data.kind, reason: parsed.data.reason, revision: (previous?.revision ?? 0) + 1, reviewedByUserId: member.userId, updatedAt: new Date() };
    const [hold] = await tx.insert(jobRetentionHolds).values({ organisationId: context.organisationId, jobId: id, ...next }).onConflictDoUpdate({ target: [jobRetentionHolds.organisationId, jobRetentionHolds.jobId], set: next }).returning();
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: member.userId, action: parsed.data.kind ? "job.retention_hold_recorded" : "job.retention_hold_cleared", resourceType: "job", resourceId: id, metadata: { previous: previous ?? null, next: hold, confirmed: true, documentHoldsUnchanged: true } });
    return ok({ hold, persisted: true });
  });
}
export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/retention">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Sign in to review survey retention.");
  const denial = await workspaceApiGuard(request, context); if (denial) return denial;
  if (!isManagementRole(context.role)) return problem(403, "forbidden", "Practice management access is required.");
  if (context.demo) return ok(null, { persisted: false });
  const { id } = await route.params; if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "Job not found.");
  const register = await withTenant(createDatabase(), context.organisationId, async tx => {
    const file = await readSurveyFileRetention(tx, context.organisationId, id);
    if (!file) return null;
    const rows = await tx.select({ id: surveyFileRemovals.id, status: surveyFileRemovals.status, manifestVersion: surveyFileRemovals.manifestVersion, createdAt: surveyFileRemovals.createdAt, completedAt: surveyFileRemovals.completedAt }).from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, context.organisationId), eq(surveyFileRemovals.jobId, id))).orderBy(desc(surveyFileRemovals.createdAt), desc(surveyFileRemovals.id)).limit(21);
    return { ...file, removals: rows.slice(0, 20), removalHistoryHasMore: rows.length > 20 };
  });
  return register ? ok(register) : problem(404, "not_found", "Job not found.");
}
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/retention">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Sign in to review survey retention.");
  const denial = await workspaceApiGuard(request, context); if (denial) return denial;
  if (!isManagementRole(context.role) || !canWriteWorkspace(context)) return problem(403, "forbidden", "Practice management access is required.");
  const parsed = await parseBody(request, input); if (!parsed.success) return problem(400, "invalid_request", "Review the current file and confirm the complaint and claim checks.");
  if (context.demo) return ok({ persisted: false });
  const { id } = await route.params; if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "Job not found.");
  return withTenant(createDatabase(), context.organisationId, async tx => {
    const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, context.internalUserId!), eq(organisationMemberships.active, true))).for("share");
    if (!member || member.role !== context.role || !isManagementRole(member.role)) return problem(403, "forbidden", "Your review permission changed.");
    const register = await readSurveyFileRetention(tx, context.organisationId, id);
    if (!register) return problem(404, "not_found", "Job not found.");
    if (register.assessment.reviewVersion !== parsed.data.reviewVersion) return problem(409, "file_changed", "Reload and review the current file and policy.");
    if (!register.assessment.eligibleForManagerReview) return problem(409, "file_protected", "The file is not eligible for an expired-retention review.");
    const [review] = await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: member.userId, action: "job.retention_file_reviewed", resourceType: "job", resourceId: id, metadata: { reviewVersion: register.assessment.reviewVersion, policy: register.policy, retentionUntil: register.assessment.retentionUntil, reason: parsed.data.reason, noUnresolvedComplaintOrClaim: true, confirmed: true, documentIds: register.documents.map(document => document.id), mediaIds: register.media.map(media => media.id), questionnaireDocumentIds: register.questionnaireDocuments.map(document => document.id), reportCount: register.reportCount, removalAuthorised: false } }).returning({ id: auditEvents.id });
    return ok({ reviewId: review.id, persisted: true, removalAuthorised: false });
  });
}
