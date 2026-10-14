import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { createDatabase, jobStageEvents, jobs, users, withTenant } from "@surveynt/db";
import { assignedJobScope } from "./workspace-scope";
import { summariseReviews } from "./review-history-model";
import type { OrganisationRole } from "@surveynt/domain";

/** Review submissions, returns and waiting reports over the last 90 days, scoped to the viewer's work. */
export async function reviewHistory(context: { organisationId: string; internalUserId: string | null; role: OrganisationRole }, now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const rows = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ jobId: jobStageEvents.jobId, reference: jobs.reference, fromStage: jobStageEvents.fromStage, toStage: jobStageEvents.toStage, reason: jobStageEvents.reason, at: jobStageEvents.createdAt, firstName: users.firstName, lastName: users.lastName })
    .from(jobStageEvents).innerJoin(jobs, and(eq(jobs.id, jobStageEvents.jobId), eq(jobs.organisationId, jobStageEvents.organisationId))).leftJoin(users, eq(users.id, jobStageEvents.changedByUserId))
    .where(and(eq(jobStageEvents.organisationId, context.organisationId), gte(jobStageEvents.createdAt, since), assignedJobScope(context))).limit(5000));
  return summariseReviews(rows.map((row) => ({ ...row, actor: [row.firstName, row.lastName].filter(Boolean).join(" ") || null })), now);
}
