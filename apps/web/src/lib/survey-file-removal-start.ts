import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, jobs, organisations, organisationMemberships, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { claimQueuedSurveyFileRemoval } from "./survey-file-removal-claim";
const input = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
/** Explicit manager review of the queued manifest; commit before storage access. */
export async function startReviewedSurveyFileRemoval(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, value: z.infer<typeof input>) {
  const decision = input.parse(value);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retention-policy:${organisationId}`},0))`);
  const [practice] = await tx.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, organisationId)).for("share");
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, userId), eq(organisationMemberships.active, true))).for("share");
  if (practice?.status !== "active" || !member || !isManagementRole(member.role)) throw new Error("Current practice management permission is required.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.id, decision.id))).for("update");
  if (!request || request.status !== "queued" || request.manifestVersion !== decision.manifestVersion) throw new Error("The queued removal decision changed.");
  const claim = await claimQueuedSurveyFileRemoval(tx, organisationId, jobId, request.id);
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.original_removal_execution_reviewed", resourceType: "survey_file_removal", resourceId: request.id, metadata: { jobId, manifestVersion: request.manifestVersion, reason: decision.reason, confirmed: true, attemptId: claim.leaseToken, originalCount: claim.manifest.objects.length, storageRemoved: false } });
  return { ...claim, remaining: claim.manifest.objects };
}
