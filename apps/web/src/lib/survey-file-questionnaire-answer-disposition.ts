import { z } from "zod";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, jobs, organisations, organisationMemberships, preinspectionDrafts, preinspectionSubmissions, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { readSurveyFileRetention } from "./survey-file-retention-register";
const decisionInput = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
export const removedAnswers = { retentionRemoved: true } as const;
export const answersRemoved = (answers: Record<string, unknown> | null | undefined) => answers?.retentionRemoved === true && Object.keys(answers).length === 1;
/** Replaces every customer statement version and the working draft with a removal marker, after completed whole-file removal. */
export async function disposeQuestionnaireAnswers(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, decision: z.infer<typeof decisionInput>) {
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
  const [draft] = await tx.select().from(preinspectionDrafts).where(and(eq(preinspectionDrafts.organisationId, organisationId), eq(preinspectionDrafts.jobId, jobId))).for("update");
  const submissions = await tx.select().from(preinspectionSubmissions).where(and(eq(preinspectionSubmissions.organisationId, organisationId), eq(preinspectionSubmissions.jobId, jobId))).orderBy(asc(preinspectionSubmissions.version)).for("update");
  if (!draft && !submissions.length) throw new Error("No customer statements are recorded for this file.");
  if ((!draft || answersRemoved(draft.answers)) && submissions.every(row => answersRemoved(row.answers))) return { disposed: true, duplicate: true };
  // Only fingerprints of the removed statements are kept as evidence, never the statements.
  const contentFingerprint = createHash("sha256").update(JSON.stringify({ draft: draft?.answers ?? null, submissions: submissions.map(row => ({ version: row.version, answers: row.answers })) })).digest("hex");
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.questionnaire_answers_disposed", resourceType: "job", resourceId: jobId, metadata: { jobId, removalId: request.id, contentFingerprint, submissionCount: submissions.length, draft: Boolean(draft), policyVersion: request.manifest.policyVersion, reason: approved.reason, confirmed: true } });
  if (draft && !answersRemoved(draft.answers)) await tx.update(preinspectionDrafts).set({ answers: removedAnswers }).where(eq(preinspectionDrafts.id, draft.id));
  for (const row of submissions) if (!answersRemoved(row.answers)) await tx.update(preinspectionSubmissions).set({ answers: removedAnswers }).where(eq(preinspectionSubmissions.id, row.id));
  return { disposed: true, duplicate: false };
}
