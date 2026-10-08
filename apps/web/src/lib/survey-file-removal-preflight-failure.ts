import { and, eq } from "drizzle-orm";
import { auditEvents, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";

/** Preflight failure is not dispatch evidence and never proves removal. */
export async function recordSurveyFilePreflightFailure(tx: TenantTransaction, organisationId: string, removalId: string, leaseToken: string, objectKey: string, reason: "storage_unavailable" | "unexpected_absence" | "original_verification_failed") {
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.id, removalId))).for("update");
  if (!request || request.leaseToken !== leaseToken || request.status !== "dispatched" || !request.lockedUntil || request.lockedUntil <= new Date()) throw new Error("The preflight lease expired or was replaced.");
  const objects = (request.manifest as { objects?: { kind: string; id: string }[] }).objects;
  if (!objects?.some(object => `${object.kind}:${object.id}` === objectKey)) throw new Error("The original is outside the approved manifest.");
  if (request.progress[objectKey]) throw new Error("Recorded dispatch requires outcome recovery instead of preflight failure.");
  await tx.update(surveyFileRemovals).set({ status: "verification_required", error: reason, lockedUntil: null, updatedAt: new Date() }).where(eq(surveyFileRemovals.id, removalId));
  await tx.insert(auditEvents).values({ organisationId, action: "job.original_removal_preflight_failed", resourceType: "survey_file_removal", resourceId: removalId, metadata: { jobId: request.jobId, objectKey, attemptId: leaseToken, reason, deletionAuthorised: false, storageRemoved: false } });
}
