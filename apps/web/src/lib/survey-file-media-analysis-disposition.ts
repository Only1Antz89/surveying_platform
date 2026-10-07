import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, jobs, organisations, organisationMemberships, mediaAnalyses, mediaAssets, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { readSurveyFileRetention } from "./survey-file-retention-register";

const decisionInput = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();

/** Internal post-removal disposition; invoke only after whole-file completion. */
export async function disposeMediaAnalysis(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, analysisId: string, decision?: z.infer<typeof decisionInput>) {
  const approved = decision ? decisionInput.parse(decision) : null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retention-policy:${organisationId}`},0))`);
  const [practice] = await tx.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, organisationId)).for("share");
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, userId), eq(organisationMemberships.active, true))).for("share");
  if (practice?.status !== "active" || !member || !isManagementRole(member.role)) throw new Error("Current active practice management permission is required.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const file = await readSurveyFileRetention(tx, organisationId, jobId);
  if (!file?.assessment.eligibleForManagerReview) throw new Error("The current file is protected or requires retention review.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.status, "completed"))).for("update");
  const [record] = await tx.select({ analysis: mediaAnalyses, checksum: mediaAssets.sha256 }).from(mediaAnalyses).innerJoin(mediaAssets, and(eq(mediaAssets.organisationId, mediaAnalyses.organisationId), eq(mediaAssets.id, mediaAnalyses.mediaId))).where(and(eq(mediaAnalyses.organisationId, organisationId), eq(mediaAnalyses.id, analysisId))).for("update");
  if (!record) throw new Error("The media analysis is unavailable.");
  const document = record.analysis;
  const objects = (request?.manifest as { objects?: { kind: string; id: string }[] } | undefined)?.objects;
  if (!request || request.progress[`media:${document.mediaId}`]?.state !== "removed" || !objects?.some(object => object.kind === "media" && object.id === document.mediaId)) throw new Error("Whole-file removal has not been verified for this original.");
  if (approved && (request.id !== approved.id || request.manifestVersion !== approved.manifestVersion)) throw new Error("The completed removal decision changed.");
  if (document.result.retentionRemoved === true && Object.keys(document.result).length === 1) return { disposed: true, duplicate: true };
  const analysisFingerprint = createHash("sha256").update(JSON.stringify(document.result)).digest("hex");
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.media_analysis_disposed", resourceType: "media_analysis", resourceId: analysisId, metadata: { jobId, removalId: request.id, mediaId: document.mediaId, originalChecksum: record.checksum, analysisFingerprint, policyVersion: request.manifest.policyVersion, ...(approved ? { reason: approved.reason, confirmed: true } : {}) } });
  await tx.update(mediaAnalyses).set({ result: { retentionRemoved: true } }).where(eq(mediaAnalyses.id, analysisId));
  return { disposed: true, duplicate: false };
}
