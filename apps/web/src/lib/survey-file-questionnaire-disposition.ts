import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, jobs, organisations, organisationMemberships, preinspectionDocuments, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { readSurveyFileRetention } from "./survey-file-retention-register";

const decisionInput = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();

/** Internal post-removal disposition; invoke only after whole-file completion. */
export async function disposeQuestionnaireAnalysis(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, documentId: string, decision?: z.infer<typeof decisionInput>) {
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
  const objects = (request?.manifest as { objects?: { kind: string; id: string }[] } | undefined)?.objects;
  if (!request || request.progress[`questionnaire:${documentId}`]?.state !== "removed" || !objects?.some(object => object.kind === "questionnaire" && object.id === documentId)) throw new Error("Whole-file removal has not been verified for this original.");
  if (approved && (request.id !== approved.id || request.manifestVersion !== approved.manifestVersion)) throw new Error("The completed removal decision changed.");
  const [document] = await tx.select().from(preinspectionDocuments).where(and(eq(preinspectionDocuments.organisationId, organisationId), eq(preinspectionDocuments.jobId, jobId), eq(preinspectionDocuments.id, documentId))).for("update");
  if (!document) throw new Error("The questionnaire original is unavailable.");
  if (document.analysis.retentionRemoved === true && Object.keys(document.analysis).length === 1) return { disposed: true, duplicate: true };
  const analysisFingerprint = createHash("sha256").update(JSON.stringify(document.analysis)).digest("hex");
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.questionnaire_analysis_disposed", resourceType: "preinspection_document", resourceId: documentId, metadata: { jobId, removalId: request.id, originalChecksum: document.checksum, analysisFingerprint, policyVersion: request.manifest.policyVersion, ...(approved ? { reason: approved.reason, confirmed: true } : {}) } });
  await tx.update(preinspectionDocuments).set({ analysis: { retentionRemoved: true } }).where(eq(preinspectionDocuments.id, documentId));
  return { disposed: true, duplicate: false };
}
