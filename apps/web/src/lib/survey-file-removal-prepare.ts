import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, jobs, mediaAssets, organisationDocuments, organisationMemberships, preinspectionDocuments, type TenantTransaction } from "@surveynt/db";
import { createSurveyFileRemovalManifest, type SurveyFileRemovalObject } from "./survey-file-removal-manifest";
import { readSurveyFileRetention } from "./survey-file-retention-register";

/** Preparation only: queues and storage dispatch must separately fence every later state change. */
export async function prepareReviewedSurveyFileRemoval(tx: TenantTransaction, organisationId: string, jobId: string, expectedReviewVersion: string) {
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const register = await readSurveyFileRetention(tx, organisationId, jobId);
  if (!register || register.assessment.reviewVersion !== expectedReviewVersion) throw new Error("The file changed; reload and complete a new manager review.");
  if (!register.assessment.eligibleForManagerReview || !register.policy) throw new Error("The survey file is protected from removal.");
  const [review] = await tx.select({ id: auditEvents.id }).from(auditEvents).innerJoin(organisationMemberships, and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, auditEvents.actorUserId), eq(organisationMemberships.active, true), inArray(organisationMemberships.role, ["owner", "administrator", "manager"]))).where(and(eq(auditEvents.organisationId, organisationId), eq(auditEvents.resourceId, jobId), eq(auditEvents.action, "job.retention_file_reviewed"), sql`${auditEvents.metadata}->>'reviewVersion' = ${expectedReviewVersion}`, sql`${auditEvents.metadata}->>'confirmed' = 'true'`, sql`${auditEvents.metadata}->>'noUnresolvedComplaintOrClaim' = 'true'`)).orderBy(desc(auditEvents.occurredAt)).limit(1).for("share", { of: organisationMemberships });
  if (!review) throw new Error("A current authorised manager must record the file review before removal.");
  const documentIds = register.documents.map(document => document.id);
  const mediaIds = register.media.map(media => media.id);
  const questionnaireIds = register.questionnaireDocuments.map(document => document.id);
  const documents = documentIds.length ? await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.organisationId, organisationId), inArray(organisationDocuments.id, documentIds))).for("update") : [];
  const media = mediaIds.length ? await tx.select().from(mediaAssets).where(and(eq(mediaAssets.organisationId, organisationId), inArray(mediaAssets.id, mediaIds))).for("update") : [];
  const questionnaires = questionnaireIds.length ? await tx.select().from(preinspectionDocuments).where(and(eq(preinspectionDocuments.organisationId, organisationId), eq(preinspectionDocuments.jobId, jobId), inArray(preinspectionDocuments.id, questionnaireIds))).for("update") : [];
  if (documents.length !== documentIds.length || media.length !== mediaIds.length || questionnaires.length !== questionnaireIds.length) throw new Error("The original register changed before preparation.");
  if (documents.some(document => !document.deletedAt || document.legalHold || document.purgeStatus !== "retained")) throw new Error("Archive and review every registered original before removal.");
  if (media.some(item => item.surveyId === null)) throw new Error("A media original has no verified survey binding.");
  const lockedRegister = await readSurveyFileRetention(tx, organisationId, jobId);
  if (!lockedRegister || lockedRegister.assessment.reviewVersion !== expectedReviewVersion || !lockedRegister.assessment.eligibleForManagerReview) throw new Error("The file changed while originals were being locked; complete a new review.");
  const objects: SurveyFileRemovalObject[] = [
    ...documents.map(document => ({ kind: "document" as const, id: document.id, storagePath: document.blobPathname, checksum: document.checksum, sizeBytes: document.sizeBytes })),
    ...questionnaires.map(document => ({ kind: "questionnaire" as const, id: document.id, storagePath: document.storageKey, checksum: document.checksum, sizeBytes: document.sizeBytes })),
    ...media.map(item => ({ kind: "media" as const, id: item.id, surveyId: item.surveyId!, derivation: item.derivation as "original" | "annotated" | "thumbnail" | "redacted" | "processed", storagePath: item.storageKey, checksum: item.sha256, sizeBytes: item.byteSize })),
  ];
  return { reviewId: review.id, manifest: createSurveyFileRemovalManifest({ organisationId, jobId, reviewVersion: expectedReviewVersion, policyVersion: register.policy.version as "survey-file-1-year-v2", objects }) };
}
