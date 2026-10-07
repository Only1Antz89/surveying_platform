import { createHash } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { jobs, jobRetentionHolds, jobStageEvents, organisationDocuments, organisationOperationalSettings, reportDeliveries, reportVersions, type TenantTransaction } from "@surveynt/db";
import { assessSurveyFileRetention, surveyFileClosureDate, surveyFileRetentionPolicy } from "./survey-file-retention";

/** Complete bounded register: exceeding the bound fails rather than reviewing a partial file. */
export async function readSurveyFileRetention(tx: TenantTransaction, organisationId: string, jobId: string) {
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, organisationId))).for("share");
  if (!job) return null;
  const [hold] = await tx.select().from(jobRetentionHolds).where(and(eq(jobRetentionHolds.organisationId, organisationId), eq(jobRetentionHolds.jobId, jobId))).for("share");
  const [settings] = await tx.select({ policy: organisationOperationalSettings.surveyFileRetentionPolicy }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, organisationId)).for("share");
  const stages = await tx.select({ fromStage: jobStageEvents.fromStage, toStage: jobStageEvents.toStage, createdAt: jobStageEvents.createdAt }).from(jobStageEvents).where(and(eq(jobStageEvents.organisationId, organisationId), eq(jobStageEvents.jobId, jobId))).orderBy(asc(jobStageEvents.createdAt)).limit(5001);
  const reports = await tx.select({ id: reportVersions.id, version: reportVersions.versionNumber, checksum: reportVersions.contentSha256 }).from(reportVersions).where(and(eq(reportVersions.organisationId, organisationId), eq(reportVersions.jobId, jobId))).orderBy(asc(reportVersions.id)).limit(5001);
  const deliveries = await tx.select({ id: reportDeliveries.id, documentId: reportDeliveries.documentId, reportVersionId: reportDeliveries.reportVersionId, status: reportDeliveries.status, deliveredAt: reportDeliveries.deliveredAt, revokedAt: reportDeliveries.revokedAt }).from(reportDeliveries).where(and(eq(reportDeliveries.organisationId, organisationId), eq(reportDeliveries.jobId, jobId))).orderBy(asc(reportDeliveries.id)).limit(5001);
  if ([stages, reports, deliveries].some(rows => rows.length > 5000)) throw new Error("The file exceeds the review register limit; arrange a complete retention review.");
  const reportIds = reports.map(report => report.id);
  const documentIds = deliveries.flatMap(delivery => delivery.documentId ? [delivery.documentId] : []);
  const documents = await tx.select({ id: organisationDocuments.id, name: organisationDocuments.name, checksum: organisationDocuments.checksum, updatedAt: organisationDocuments.updatedAt, legalHold: organisationDocuments.legalHold, archivedAt: organisationDocuments.deletedAt, purgeStatus: organisationDocuments.purgeStatus, retentionUntil: organisationDocuments.retentionUntil }).from(organisationDocuments).where(and(eq(organisationDocuments.organisationId, organisationId), or(eq(organisationDocuments.jobId, jobId), reportIds.length ? inArray(organisationDocuments.reportVersionId, reportIds) : undefined, documentIds.length ? inArray(organisationDocuments.id, documentIds) : undefined))).orderBy(asc(organisationDocuments.id)).limit(5001);
  if (documents.length > 5000) throw new Error("The file exceeds the review register limit; arrange a complete retention review.");
  const received = deliveries.filter(delivery => delivery.status === "delivered" && delivery.deliveredAt !== null && reportIds.includes(delivery.reportVersionId));
  const latestReport = reports.reduce<(typeof reports)[number] | null>((latest, report) => !latest || report.version > latest.version ? report : latest, null);
  const latestDelivered = latestReport !== null && received.some(delivery => delivery.reportVersionId === latestReport.id);
  const finalDeliveredAt = latestDelivered && received.length ? new Date(Math.max(...received.map(delivery => delivery.deliveredAt!.getTime()))) : null;
  const policy = settings?.policy ?? null;
  const assessment = assessSurveyFileRetention({ jobId, jobVersion: job.version, closedAt: surveyFileClosureDate(job.stage, stages), finalDeliveredAt, jobClosed: job.stage === "archived", legalHold: hold?.kind === "legal" || documents.some(document => document.legalHold), unresolvedComplaintOrClaim: hold?.kind === "complaint" || hold?.kind === "claim", practicePolicyApproved: policy?.enabled === true && policy.version === surveyFileRetentionPolicy.version });
  // Every report, receipt, original, stage transition and policy revision binds the review.
  const reviewVersion = createHash("sha256").update(JSON.stringify({ assessment: assessment.reviewVersion, policy, hold, stages, reports, deliveries, documents })).digest("hex");
  return { jobId, reference: job.reference, jobVersion: job.version, policy, hold: hold ?? null, assessment: { ...assessment, reviewVersion }, documents, reportCount: reports.length, deliveryCount: received.length,
    complaintClaimCheckRequired: true, removalAuthorised: false as const };
}
