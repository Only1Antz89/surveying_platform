import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auditEvents, surveyFileRemovals, withTenant, type Database, type TenantTransaction } from "@surveynt/db";
import { boundedStorageOperation } from "./document-original-verification";
import { recordSurveyFileOriginalOutcome } from "./survey-file-removal-object-outcome";
import { createSurveyFileRemovalManifest } from "./survey-file-removal-manifest";
import type { ObjectStorage } from "./storage";

/** Recovery leases permit observation only. They never authorise another storage delete. */
export async function claimSurveyFileRemovalRecovery(tx: TenantTransaction, organisationId: string, removalId: string) {
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.id, removalId))).for("update");
  if (!request || !["dispatched", "verification_required"].includes(request.status)) throw new Error("No interrupted removal requires recovery.");
  if (request.status === "dispatched" && request.lockedUntil && request.lockedUntil > new Date()) throw new Error("The original removal lease is still active.");
  const { manifestVersion, ...input } = request.manifest as Parameters<typeof createSurveyFileRemovalManifest>[0] & { manifestVersion: string };
  const manifest = createSurveyFileRemovalManifest(input);
  if (manifestVersion !== request.manifestVersion || manifest.manifestVersion !== manifestVersion) throw new Error("The recovery manifest cannot be verified.");
  const objects = manifest.objects.filter(object => { const state = request.progress[`${object.kind}:${object.id}`]?.state; return state === "dispatched" || state === "verification_required"; }).slice(0, 1);
  if (!objects.length) throw new Error("No recorded original dispatch exists; operator review is required.");
  const leaseToken = randomUUID(); const lockedUntil = new Date(Date.now() + 300000);
  const progress = { ...request.progress };
  for (const object of objects) progress[`${object.kind}:${object.id}`] = { state: "verification_required", attemptId: leaseToken };
  await tx.update(surveyFileRemovals).set({ status: "dispatched", leaseToken, lockedUntil, attempts: request.attempts + 1, progress, updatedAt: new Date() }).where(eq(surveyFileRemovals.id, removalId));
  await tx.insert(auditEvents).values({ organisationId, action: "job.original_removal_observation_claimed", resourceType: "survey_file_removal", resourceId: removalId, metadata: { previousAttemptId: request.leaseToken, previousProgress: request.progress, attemptId: leaseToken, manifestVersion, deletionAuthorised: false } });
  return { id: removalId, leaseToken, objects };
}

export async function observeInterruptedSurveyFileOriginal(db: Database, organisationId: string, recovery: Awaited<ReturnType<typeof claimSurveyFileRemovalRecovery>>, objectKey: string, storage: ObjectStorage) {
  const object = recovery.objects.find(entry => `${entry.kind}:${entry.id}` === objectKey);
  if (!object) throw new Error("The original has no interrupted dispatch evidence.");
  let existing: Awaited<ReturnType<ObjectStorage["get"]>>;
  try {
    existing = await boundedStorageOperation(storage.get(object.storagePath), value => { if (value) void value.stream.cancel().catch(() => undefined); });
    if (existing) await existing.stream.cancel();
  } catch {
    await withTenant(db, organisationId, tx => recordSurveyFileOriginalOutcome(tx, organisationId, recovery.id, recovery.leaseToken, objectKey, { state: "verification_required", reason: "storage_unavailable" }));
    return { removed: false, verificationRequired: true };
  }
  const verificationRequired = await withTenant(db, organisationId, async tx => {
    const outcome = await recordSurveyFileOriginalOutcome(tx, organisationId, recovery.id, recovery.leaseToken, objectKey, existing ? { state: "verification_required", reason: "object_still_present" } : { state: "removed" });
    if (outcome.status === "dispatched") {
      await tx.update(surveyFileRemovals).set({ status: "verification_required", lockedUntil: null, error: "additional_originals_require_review", updatedAt: new Date() }).where(and(eq(surveyFileRemovals.id, recovery.id), eq(surveyFileRemovals.leaseToken, recovery.leaseToken), eq(surveyFileRemovals.status, "dispatched")));
      await tx.insert(auditEvents).values({ organisationId, action: "job.original_removal_partial_observation", resourceType: "survey_file_removal", resourceId: recovery.id, metadata: { objectKey, attemptId: recovery.leaseToken, deletionAuthorised: false } });
    }
    return Boolean(existing) || outcome.status !== "completed";
  });
  return { removed: !existing, verificationRequired };
}
