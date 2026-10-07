import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, organisations, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { revalidateQueuedSurveyFileRemoval } from "./survey-file-removal-revalidate";

/** Commit this claim before storage I/O. A claim does not prove any original was removed. */
export async function claimQueuedSurveyFileRemoval(tx: TenantTransaction, organisationId: string, jobId: string, removalId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retention-policy:${organisationId}`},0))`);
  const [organisation] = await tx.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, organisationId)).for("share");
  if (!organisation || organisation.status !== "active") throw new Error("Removal requires an active practice.");
  const prepared = await revalidateQueuedSurveyFileRemoval(tx, organisationId, jobId, removalId);
  const leaseToken = randomUUID();
  const lockedUntil = new Date(Date.now() + 5 * 60 * 1000);
  const attempts = prepared.request.attempts + 1;
  const [claimed] = await tx.update(surveyFileRemovals).set({ status: "dispatched", leaseToken, lockedUntil, attempts, updatedAt: new Date() }).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.id, removalId), eq(surveyFileRemovals.status, "queued"))).returning({ id: surveyFileRemovals.id });
  if (!claimed) throw new Error("The removal claim changed before dispatch.");
  await tx.insert(auditEvents).values({ organisationId, action: "job.original_removal_dispatch_claimed", resourceType: "survey_file_removal", resourceId: removalId, metadata: { jobId, manifestVersion: prepared.manifest.manifestVersion, attemptId: leaseToken, attempts, lockedUntil: lockedUntil.toISOString(), storageRemoved: false } });
  return { id: claimed.id, leaseToken, lockedUntil, attempts, manifest: prepared.manifest };
}
