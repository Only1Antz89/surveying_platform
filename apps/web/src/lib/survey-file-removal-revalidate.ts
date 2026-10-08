import { and, eq } from "drizzle-orm";
import { jobs, organisationMemberships, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { prepareReviewedSurveyFileRemoval } from "./survey-file-removal-prepare";

/** Transaction-local validation only. Dispatch also requires durable reference fencing. */
export async function revalidateQueuedSurveyFileRemoval(tx: TenantTransaction, organisationId: string, jobId: string, removalId: string) {
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.id, removalId))).for("update");
  if (!request || request.status !== "queued") throw new Error("Only an undispatched removal request can be prepared.");
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, request.requestedByUserId), eq(organisationMemberships.active, true))).for("share");
  if (!member || !isManagementRole(member.role)) throw new Error("The requesting manager no longer has removal permission.");
  const prepared = await prepareReviewedSurveyFileRemoval(tx, organisationId, jobId, request.reviewVersion);
  if (prepared.manifest.manifestVersion !== request.manifestVersion) throw new Error("The original storage manifest changed; a new decision is required.");
  return { request, manifest: prepared.manifest };
}
