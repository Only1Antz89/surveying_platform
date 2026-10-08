import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, jobs, organisations, organisationMemberships, surveyFileRemovals, type TenantTransaction } from "@surveynt/db";
import { claimSurveyFileRemovalRecovery } from "./survey-file-removal-recovery";
const input = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
/** Commits an authorised observation lease before storage is read. No deletion permission. */
export async function reviewRemovalObservation(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, value: z.infer<typeof input>) {
  const decision = input.parse(value);
  const [practice] = await tx.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, organisationId)).for("share");
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.userId, userId), eq(organisationMemberships.active, true))).for("share");
  if (practice?.status !== "active" || !member || !isManagementRole(member.role)) throw new Error("Current practice management permission is required.");
  const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organisationId, organisationId), eq(jobs.id, jobId))).for("update");
  if (!job) throw new Error("The survey file is unavailable.");
  const [request] = await tx.select().from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId, organisationId), eq(surveyFileRemovals.jobId, jobId), eq(surveyFileRemovals.id, decision.id))).for("update");
  if (!request || request.manifestVersion !== decision.manifestVersion) throw new Error("The removal decision changed.");
  const recovery = await claimSurveyFileRemovalRecovery(tx, organisationId, request.id);
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.original_removal_observation_reviewed", resourceType: "survey_file_removal", resourceId: request.id, metadata: { jobId, manifestVersion: decision.manifestVersion, reason: decision.reason, confirmed: true, attemptId: recovery.leaseToken, deletionAuthorised: false } });
  return recovery;
}
