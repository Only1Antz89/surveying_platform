import { and, eq, sql } from "drizzle-orm";
import { auditEvents, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";

type Outcome = { state: "removed" } | { state: "verification_required"; reason: "storage_unavailable" | "checksum_mismatch" | "unexpected_absence" | "uncertain_delete" | "object_still_present" };
/** Internal worker evidence only: call removed only after verifying exact-object absence. */
export async function recordSurveyFileOriginalOutcome(tx: TenantTransaction, organisationId: string, removalId: string, leaseToken: string, objectKey: string, outcome: Outcome) {
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.id, removalId))).for("update");
  if (!request || request.leaseToken !== leaseToken) throw new Error("The removal attempt was replaced or is unavailable.");
  const existing = request.progress[objectKey];
  if (!existing || existing.attemptId !== leaseToken) throw new Error("No matching original dispatch was recorded.");
  if (existing.state === "removed") return { duplicate: true, status: request.status };
  if (request.status !== "dispatched" || !request.lockedUntil || request.lockedUntil <= new Date()) throw new Error("The removal outcome lease expired; operator verification is required.");
  // The evidence guard compares against the database clock. Host clock skew must
  // not turn a verified absence into a rejected future observation.
  const observation = outcome.state === "removed" ? await tx.execute(sql`select clock_timestamp()::text as "observedAt"`) : null;
  const progress = { ...request.progress, [objectKey]: outcome.state === "removed" ? { state: "removed", attemptId: leaseToken, removedAt: new Date(String(observation!.rows[0].observedAt)).toISOString() } : { state: "verification_required", attemptId: leaseToken } };
  const objects = (request.manifest as { objects?: { kind: string; id: string }[] }).objects;
  if (!objects?.length || !objects.some(object => `${object.kind}:${object.id}` === objectKey)) throw new Error("The original is outside the approved manifest.");
  const complete = objects.every(object => progress[`${object.kind}:${object.id}`]?.state === "removed");
  const status = complete ? "completed" : outcome.state === "verification_required" ? "verification_required" : "dispatched";
  await tx.update(surveyFileRemovals).set({ progress, status, error: outcome.state === "verification_required" ? outcome.reason : null, lockedUntil: status === "dispatched" ? request.lockedUntil : null, completedAt: complete ? new Date() : null, updatedAt: new Date() }).where(eq(surveyFileRemovals.id, removalId));
  await tx.insert(auditEvents).values({ organisationId, action: outcome.state === "removed" ? "job.original_storage_removal_verified" : "job.original_storage_verification_required", resourceType: "survey_file_removal", resourceId: removalId, metadata: { jobId: request.jobId, objectKey, attemptId: leaseToken, manifestVersion: request.manifestVersion, outcome } });
  return { duplicate: false, status };
}
