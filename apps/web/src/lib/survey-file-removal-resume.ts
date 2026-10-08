import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, jobs, organisations, organisationMemberships, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { prepareReviewedSurveyFileRemoval } from "./survey-file-removal-prepare";
const input = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
/** Commit before processing untouched originals; uncertain dispatches must be observed first. */
export async function resumeReviewedSurveyFileRemoval(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, value: z.infer<typeof input>) {
  const decision = input.parse(value);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retention-policy:${organisationId}`},0))`);
  const [practice] = await tx.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, organisationId)).for("share");
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, userId), eq(organisationMemberships.active, true))).for("share");
  if (practice?.status !== "active" || !member || !isManagementRole(member.role)) throw new Error("Current practice management permission is required.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.id, decision.id))).for("update");
  if (!request || request.status !== "verification_required" || request.manifestVersion !== decision.manifestVersion) throw new Error("The partial removal decision changed.");
  const outcomes = Object.values(request.progress);
  if ((!outcomes.length && request.error !== "additional_originals_require_review") || outcomes.some(outcome => outcome.state !== "removed")) throw new Error("Every interrupted dispatch must be verified before resuming untouched originals.");
  const [requester] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, request.requestedByUserId), eq(organisationMemberships.active, true))).for("share");
  if (!requester || !isManagementRole(requester.role)) throw new Error("The requesting manager no longer has removal permission.");
  const prepared = await prepareReviewedSurveyFileRemoval(tx, organisationId, jobId, request.reviewVersion);
  if (prepared.manifest.manifestVersion !== request.manifestVersion) throw new Error("The approved original manifest changed.");
  const remaining = prepared.manifest.objects.filter(object => !request.progress[`${object.kind}:${object.id}`]);
  if (!remaining.length) throw new Error("No untouched originals remain for resumption.");
  const leaseToken = randomUUID(), lockedUntil = new Date(Date.now() + 300000), attempts = request.attempts + 1;
  await tx.update(surveyFileRemovals).set({ status: "dispatched", leaseToken, lockedUntil, attempts, error: null, updatedAt: new Date() }).where(eq(surveyFileRemovals.id, request.id));
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.original_removal_resumption_reviewed", resourceType: "survey_file_removal", resourceId: request.id, metadata: { jobId, manifestVersion: request.manifestVersion, reason: decision.reason, confirmed: true, attemptId: leaseToken, remainingOriginalCount: remaining.length, storageRemoved: false } });
  return { id: request.id, leaseToken, lockedUntil, attempts, manifest: prepared.manifest, remaining };
}
