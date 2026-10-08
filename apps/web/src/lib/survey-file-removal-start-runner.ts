import { and, eq } from "drizzle-orm";
import { auditEvents, jobs, surveyFileRemovals, withTenant, type Database } from "@surveynt/db";
import { startReviewedSurveyFileRemoval } from "./survey-file-removal-start";
import { processSurveyFileOriginal } from "./survey-file-removal-storage";
import type { ObjectStorage } from "./storage";

/** Explicitly reviewed execution only; not a scheduler or hosted activation. */
export async function processReviewedQueuedOriginals(db: Database, organisationId: string, jobId: string, userId: string, decision: Parameters<typeof startReviewedSurveyFileRemoval>[4], storage: ObjectStorage) {
  const claim = await withTenant(db, organisationId, tx => startReviewedSurveyFileRemoval(tx, organisationId, jobId, userId, decision));
  const deadline = Date.now() + 40000;
  let processed = 0;
  for (const object of claim.remaining) {
    if (processed >= 25 || Date.now() >= deadline) break;
    const result = await processSurveyFileOriginal(db, organisationId, jobId, claim, `${object.kind}:${object.id}`, storage);
    if (result.verificationRequired || !result.removed) return { completed: false, verificationRequired: true, processed };
    processed++;
  }
  if (processed === claim.remaining.length) return { completed: true, verificationRequired: false, processed };
  await withTenant(db, organisationId, async tx => {
    await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
    const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.id, claim.id))).for("update");
    if (!request || request.status !== "dispatched" || request.leaseToken !== claim.leaseToken) throw new Error("The execution lease changed before pausing.");
    await tx.update(surveyFileRemovals).set({ status: "verification_required", lockedUntil: null, error: "additional_originals_require_review", updatedAt: new Date() }).where(eq(surveyFileRemovals.id, claim.id));
    await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.original_removal_batch_paused", resourceType: "survey_file_removal", resourceId: claim.id, metadata: { jobId, attemptId: claim.leaseToken, processed, remainingOriginalCount: claim.remaining.length - processed } });
  });
  return { completed: false, verificationRequired: true, processed };
}
