import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { isManagementRole } from "@surveynt/domain";
import { fieldProposals, auditEvents, jobs, organisations, organisationMemberships, surveyFileRemovals, surveys, type TenantTransaction } from "@surveynt/db";
import { readSurveyFileRetention } from "./survey-file-retention-register";
const decisionInput = z.object({ id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
export async function disposeFieldProposal(tx: TenantTransaction, organisationId: string, jobId: string, userId: string, proposalId: string, decision: z.infer<typeof decisionInput>) {
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
  const [record] = await tx.select({ proposal: fieldProposals }).from(fieldProposals).innerJoin(surveys, and(eq(surveys.organisationId, fieldProposals.organisationId), eq(surveys.id, fieldProposals.surveyId))).where(and(eq(fieldProposals.organisationId, organisationId), eq(fieldProposals.id, proposalId), eq(surveys.jobId, jobId))).for("update");
  if (!record) throw new Error("The field proposal is unavailable.");
  const proposal = record.proposal;
  if (proposal.proposedValue.retentionRemoved === true && Object.keys(proposal.proposedValue).length === 1 && proposal.evidenceRefs.length === 0 && proposal.limitations.length === 0 && proposal.reviewNote === null) return { disposed: true, duplicate: true };
  const contentFingerprint = createHash("sha256").update(JSON.stringify({ proposedValue: proposal.proposedValue, evidenceRefs: proposal.evidenceRefs, limitations: proposal.limitations, reviewNote: proposal.reviewNote })).digest("hex");
  await tx.insert(auditEvents).values({ organisationId, actorUserId: userId, action: "job.field_proposal_disposed", resourceType: "field_proposal", resourceId: proposalId, metadata: { jobId, removalId: request.id, contentFingerprint, policyVersion: request.manifest.policyVersion, reason: approved.reason, confirmed: true } });
  await tx.update(fieldProposals).set({ proposedValue: { retentionRemoved: true }, evidenceRefs: [], limitations: [], reviewNote: null }).where(eq(fieldProposals.id, proposalId));
  return { disposed: true, duplicate: false };
}
