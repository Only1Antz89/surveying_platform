import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { isManagementRole } from "@surveynt/domain";
import { surveyFieldValues, auditEvents, jobs, organisations, organisationMemberships, surveyFileRemovals, surveys, type TenantTransaction } from "@surveynt/db";
import { readSurveyFileRetention } from "./survey-file-retention-register";
const decisionInput = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
export async function disposeRecordedFieldValue(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, valueId: string, decision: z.infer<typeof decisionInput>) {
  const approved = decisionInput.parse(decision);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retention-policy:${organisationId}`},0))`);
  const [practice] = await tx.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, organisationId)).for("share");
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, userId), eq(organisationMemberships.active, true))).for("share");
  if (practice?.status !== "active" || !member || !isManagementRole(member.role)) throw new Error("Current active practice management permission is required.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const file = await readSurveyFileRetention(tx, organisationId, jobId);
  if (!file?.assessment.eligibleForManagerReview) throw new Error("The current file is protected or requires retention review.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.status, "completed"))).for("update");
  if (!request || request.id !== approved.id || request.manifestVersion !== approved.manifestVersion) throw new Error("The completed removal decision changed.");
  const [record] = await tx.select({ recorded: surveyFieldValues }).from(surveyFieldValues).innerJoin(surveys, and(eq(surveys.organisationId, surveyFieldValues.organisationId), eq(surveys.id, surveyFieldValues.surveyId))).where(and(eq(surveyFieldValues.organisationId, organisationId), eq(surveyFieldValues.id, valueId), eq(surveys.jobId, jobId))).for("update");
  if (!record) throw new Error("The recorded survey answer is unavailable.");
  const recorded = record.recorded;
  if (recorded.value.retentionRemoved === true && Object.keys(recorded.value).length === 1 && recorded.sourceRef === null && recorded.correctionReason === null) return { disposed: true, duplicate: true };
  const contentFingerprint = createHash("sha256").update(JSON.stringify({ value: recorded.value, sourceRef: recorded.sourceRef, correctionReason: recorded.correctionReason })).digest("hex");
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.recorded_field_value_disposed", resourceType: "survey_field_value", resourceId: valueId, metadata: { jobId, removalId: request.id, contentFingerprint, policyVersion: request.manifest.policyVersion, reason: approved.reason, confirmed: true } });
  await tx.update(surveyFieldValues).set({ value: { retentionRemoved: true }, sourceRef: null, correctionReason: null }).where(eq(surveyFieldValues.id, valueId));
  return { disposed: true, duplicate: false };
}
