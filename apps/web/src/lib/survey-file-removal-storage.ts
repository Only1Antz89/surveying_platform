import { withTenant, type Database } from "@surveynt/db";
import { boundedStorageOperation, verifyDocumentOriginal } from "./document-original-verification";
import { recordSurveyFileOriginalDispatch } from "./survey-file-removal-object-dispatch";
import { recordSurveyFileOriginalOutcome } from "./survey-file-removal-object-outcome";
import type { claimQueuedSurveyFileRemoval } from "./survey-file-removal-claim";
import type { ObjectStorage } from "./storage";
import { recordSurveyFilePreflightFailure } from "./survey-file-removal-preflight-failure";
import { readOriginalProcessingOutcome } from "./survey-file-removal-processing-state";

/** Internal processor. Supply only a committed server claim and the configured storage adapter. */
export async function processSurveyFileOriginal(db: Database, organisationId: string, jobId: string, claim: Awaited<ReturnType<typeof claimQueuedSurveyFileRemoval>>, objectKey: string, storage: ObjectStorage) {
  if (claim.manifest.organisationId !== organisationId || claim.manifest.jobId !== jobId) throw new Error("The removal claim belongs to another file.");
  const object = claim.manifest.objects.find(entry => `${entry.kind}:${entry.id}` === objectKey);
  if (!object) throw new Error("The original is outside the approved manifest.");
  const recorded = await withTenant(db, organisationId, tx => readOriginalProcessingOutcome(tx, organisationId, claim.id, claim.leaseToken, objectKey));
  if (recorded) return recorded;
  let failure: "storage_unavailable" | "unexpected_absence" | "original_verification_failed" = "storage_unavailable";
  try {
    const existing = await boundedStorageOperation(storage.get(object.storagePath, { fresh: true }), value => { if (value) void value.stream.cancel().catch(() => undefined); });
    failure = "unexpected_absence";
    if (!existing) throw new Error("Original unexpectedly absent before verified dispatch.");
    failure = "original_verification_failed";
    await verifyDocumentOriginal(existing.stream, object.sizeBytes, object.checksum);
  } catch {
    await withTenant(db, organisationId, tx => recordSurveyFilePreflightFailure(tx, organisationId, claim.id, claim.leaseToken, objectKey, failure));
    return { removed: false, verificationRequired: true };
  }
  const dispatch = await withTenant(db, organisationId, tx => recordSurveyFileOriginalDispatch(tx, organisationId, jobId, claim.id, claim.leaseToken, objectKey));
  if (!dispatch.dispatch) return { removed: false, verificationRequired: true };
  let reason: "uncertain_delete" | "object_still_present" = "uncertain_delete";
  try {
    await boundedStorageOperation(storage.remove(dispatch.object.storagePath));
    const remaining = await boundedStorageOperation(storage.get(dispatch.object.storagePath, { fresh: true }), value => { if (value) void value.stream.cancel().catch(() => undefined); });
    if (remaining) { await remaining.stream.cancel(); reason = "object_still_present"; throw new Error("Original remains in storage."); }
  } catch {
    await withTenant(db, organisationId, tx => recordSurveyFileOriginalOutcome(tx, organisationId, claim.id, claim.leaseToken, objectKey, { state: "verification_required", reason }));
    return { removed: false, verificationRequired: true };
  }
  await withTenant(db, organisationId, tx => recordSurveyFileOriginalOutcome(tx, organisationId, claim.id, claim.leaseToken, objectKey, { state: "removed" }));
  return { removed: true, verificationRequired: false };
}
