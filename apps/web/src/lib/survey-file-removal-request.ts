import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, jobs, organisationMemberships, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { surveyFileRemovalCanCancel } from "./survey-file-removal-cancellation";
import { prepareReviewedSurveyFileRemoval } from "./survey-file-removal-prepare";

const input = z.object({ requestId: z.uuid(), reviewVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
const cancellation = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();

/** Cancel queued or failed-preflight intent only when no original dispatch exists. */
export async function cancelReviewedSurveyFileRemoval(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, value: z.infer<typeof cancellation>) {
  const parsed = cancellation.parse(value);
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, userId), eq(organisationMemberships.active, true))).for("share");
  if (!member || !isManagementRole(member.role)) throw new Error("Current practice management permission is required.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.id, parsed.id))).for("update");
  if (!request || request.manifestVersion !== parsed.manifestVersion) throw new Error("The removal decision changed or is unavailable.");
  if (request.status === "cancelled") return { id: request.id, status: request.status, duplicate: true };
  const [eligibility] = await tx.select({ canCancel: surveyFileRemovalCanCancel }).from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.id, request.id))).limit(1);
  if (!eligibility?.canCancel) throw new Error("Dispatched removal requires outcome verification and cannot be cancelled.");
  await tx.update(surveyFileRemovals).set({ status: "cancelled", lockedUntil: null, updatedAt: new Date() }).where(eq(surveyFileRemovals.id, request.id));
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.original_removal_cancelled", resourceType: "survey_file_removal", resourceId: request.id, metadata: { jobId, manifestVersion: request.manifestVersion, reason: parsed.reason, confirmed: true, storageRemoved: false } });
  return { id: request.id, status: "cancelled" as const, duplicate: false };
}
/** Durable intent only. Storage is untouched; the worker must revalidate and fence dispatch. */
export async function requestReviewedSurveyFileRemoval(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, value: z.infer<typeof input>) {
  const parsed = input.parse(value);
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, userId), eq(organisationMemberships.active, true))).for("share");
  if (!member || !isManagementRole(member.role)) throw new Error("Current practice management permission is required.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ organisationId, jobId, userId, ...parsed })).digest("hex");
  const [previous] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.requestId, parsed.requestId))).for("update");
  if (previous) {
    if (previous.jobId !== jobId || previous.requestFingerprint !== requestFingerprint) throw new Error("This removal request identifier was already used for a different decision.");
    return { id: previous.id, status: previous.status, duplicate: true, storageRemoved: previous.status === "completed" };
  }
  const [active] = await tx.select({ id: surveyFileRemovals.id }).from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), ne(surveyFileRemovals.status, "cancelled"))).for("update");
  if (active) throw new Error("A removal request already exists for this file. Review its outcome before another request.");
  const prepared = await prepareReviewedSurveyFileRemoval(tx, organisationId, jobId, parsed.reviewVersion);
  const [request] = await tx.insert(surveyFileRemovals).values({ organisationId, jobId, requestId: parsed.requestId, requestedByUserId: userId, reviewId: prepared.reviewId, reviewVersion: parsed.reviewVersion, requestFingerprint, manifestVersion: prepared.manifest.manifestVersion, manifest: prepared.manifest, reason: parsed.reason }).returning();
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.original_removal_requested", resourceType: "survey_file_removal", resourceId: request.id, metadata: { jobId, reviewId: prepared.reviewId, reviewVersion: parsed.reviewVersion, manifestVersion: prepared.manifest.manifestVersion, objectCount: prepared.manifest.objects.length, confirmed: true, storageRemoved: false } });
  return { id: request.id, status: request.status, duplicate: false, storageRemoved: false };
}
