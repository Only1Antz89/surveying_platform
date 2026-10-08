import { and, eq, sql } from "drizzle-orm";
import { auditEvents, jobs, organisations, organisationMemberships, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { prepareReviewedSurveyFileRemoval } from "./survey-file-removal-prepare";

/** Commit before I/O. Existing attempts require verification, never automatic repeat deletion. */
export async function recordSurveyFileOriginalDispatch(tx: TenantTransaction, organisationId: string, jobId: string, removalId: string, leaseToken: string, objectKey: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retention-policy:${organisationId}`},0))`);
  const [organisation] = await tx.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, organisationId)).for("share");
  if (!organisation || organisation.status !== "active") throw new Error("Removal requires an active practice.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.id, removalId), eq(surveyFileRemovals.jobId, jobId))).for("update");
  if (!request || request.status !== "dispatched" || request.leaseToken !== leaseToken || !request.lockedUntil || request.lockedUntil <= new Date()) throw new Error("The removal dispatch lease is unavailable or expired.");
  if (request.progress[objectKey]) return { dispatch: false as const, verificationRequired: true as const };
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, request.requestedByUserId), eq(organisationMemberships.active, true))).for("share");
  if (!member || !isManagementRole(member.role)) throw new Error("The requesting manager no longer has removal permission.");
  const prepared = await prepareReviewedSurveyFileRemoval(tx, organisationId, jobId, request.reviewVersion);
  if (prepared.manifest.manifestVersion !== request.manifestVersion) throw new Error("The approved original manifest changed.");
  const object = prepared.manifest.objects.find(entry => `${entry.kind}:${entry.id}` === objectKey);
  if (!object) throw new Error("The original is outside the approved manifest.");
  await tx.update(surveyFileRemovals).set({ progress: { ...request.progress, [objectKey]: { state: "dispatched", attemptId: leaseToken } }, updatedAt: new Date() }).where(eq(surveyFileRemovals.id, removalId));
  await tx.insert(auditEvents).values({ organisationId, action: "job.original_storage_dispatch_recorded", resourceType: "survey_file_removal", resourceId: removalId, metadata: { jobId, objectKey, attemptId: leaseToken, manifestVersion: request.manifestVersion, storageRemoved: false } });
  return { dispatch: true as const, verificationRequired: false as const, object };
}
