import { and, eq } from "drizzle-orm";
import { surveyFileRemovals, type TenantTransaction } from "@surveynt/db";

/** A retry may read durable evidence; it cannot authorise another deletion. */
export async function readOriginalProcessingOutcome(tx: TenantTransaction, organisationId: string, removalId: string, leaseToken: string, objectKey: string) {
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.id, removalId))).limit(1);
  const objects = (request?.manifest as { objects?: { kind: string; id: string }[] } | undefined)?.objects;
  if (!request || !objects?.some(object => `${object.kind}:${object.id}` === objectKey)) throw new Error("The original removal request is unavailable.");
  const progress = request.progress[objectKey];
  if (progress) return { removed: progress.state === "removed", verificationRequired: progress.state !== "removed" };
  if (request.status !== "dispatched" || request.leaseToken !== leaseToken || !request.lockedUntil || request.lockedUntil <= new Date()) throw new Error("The original processing lease expired or was replaced.");
  return null;
}
