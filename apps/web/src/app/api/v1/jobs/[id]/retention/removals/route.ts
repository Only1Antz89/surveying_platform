import { disposeEvidenceAnnotation } from "@/lib/survey-file-evidence-annotation-disposition";
import { disposeMediaMetadata } from "@/lib/survey-file-media-metadata-disposition";
import { disposeElementContent } from "@/lib/survey-file-element-disposition";
import { z } from "zod";
import { createDatabase, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok, parseBody, problem } from "@/lib/api";
import { cancelReviewedSurveyFileRemoval, requestReviewedSurveyFileRemoval } from "@/lib/survey-file-removal-request";

import { disposeQuestionnaireAnalysis } from "@/lib/survey-file-questionnaire-disposition";

import { disposeMediaAnalysis } from "@/lib/survey-file-media-analysis-disposition";

import { reviewRemovalObservation } from "@/lib/survey-file-removal-observation-review";
import { observeInterruptedSurveyFileOriginal } from "@/lib/survey-file-removal-recovery";
import { processReviewedRemainingOriginals } from "@/lib/survey-file-removal-resume-runner";
import { getObjectStorage } from "@/lib/storage";

import { disposeAdviserTask } from "@/lib/survey-file-adviser-task-disposition";

import { disposeFieldProposal } from "@/lib/survey-file-field-proposal-disposition";

import { disposeReportContent } from "@/lib/survey-file-report-content-disposition";

import { processReviewedQueuedOriginals } from "@/lib/survey-file-removal-start-runner";

import { disposeRecordedFieldValue } from "@/lib/survey-file-recorded-value-disposition";

import { disposeObservationContent } from "@/lib/survey-file-observation-disposition";

const common = { reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) };
const input = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("request"), requestId: z.uuid(), reviewVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...common, action: z.literal("dispose_observation"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), observationId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_element"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), elementId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_media_metadata"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), mediaId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_evidence_annotation"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), linkId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_value"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), valueId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_report"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), reportId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_proposal"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), proposalId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_task"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), taskId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_media_analysis"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), analysisId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_analysis"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), documentId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("start"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...common, action: z.literal("resume"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...common, action: z.literal("observe"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...common, action: z.literal("cancel"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to review removal requests.");
  const denial = await workspaceApiGuard(request, context); if (denial) return denial;
  if (!isManagementRole(context.role) || !canWriteWorkspace(context)) return problem(403, "forbidden", "Practice management access is required.");
  const parsed = await parseBody(request, input);
  if (!parsed.success) return problem(400, "invalid_request", "Review the current decision, record a reason and confirm it.");
  if (context.demo) return ok({ persisted: false, storageRemoved: false });
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "Job not found.");
  try {
    const decision = parsed.data;
    if (decision.action === "start" || decision.action === "resume") {
      const storage = getObjectStorage();
      if (!storage) return problem(503, "storage_unavailable", "Original storage is unavailable. Retry after restoring storage access.");
      const outcome = await (decision.action === "start" ? processReviewedQueuedOriginals : processReviewedRemainingOriginals)(createDatabase(), context.organisationId, id, context.internalUserId!, { id: decision.id, manifestVersion: decision.manifestVersion, reason: decision.reason, confirmed: decision.confirmed }, storage);
      return ok({ ...outcome, persisted: true });
    }
    if (decision.action === "observe") {
      const storage = getObjectStorage();
      if (!storage) return problem(503, "storage_unavailable", "Original storage is unavailable. Retry the observation later.");
      const database = createDatabase();
      const recovery = await withTenant(database, context.organisationId, tx => reviewRemovalObservation(tx, context.organisationId, id, context.internalUserId!, { id: decision.id, manifestVersion: decision.manifestVersion, reason: decision.reason, confirmed: decision.confirmed }));
      const object = recovery.objects[0];
      const outcome = await observeInterruptedSurveyFileOriginal(database, context.organisationId, recovery, `${object.kind}:${object.id}`, storage);
      return ok({ ...outcome, persisted: true, deletionAuthorised: false });
    }
    const result = await withTenant(createDatabase(), context.organisationId, async tx => {
      if (decision.action === "request") {
        const value = { requestId: decision.requestId, reviewVersion: decision.reviewVersion, reason: decision.reason, confirmed: decision.confirmed };
        return requestReviewedSurveyFileRemoval(tx, context.organisationId, id, context.internalUserId!, value);
      }
      const value = { id: decision.id, manifestVersion: decision.manifestVersion, reason: decision.reason, confirmed: decision.confirmed };
      if (decision.action === "dispose_observation") return disposeObservationContent(tx, context.organisationId, id, context.internalUserId!, decision.observationId, value);
      if (decision.action === "dispose_element") return disposeElementContent(tx, context.organisationId, id, context.internalUserId!, decision.elementId, value);
      if (decision.action === "dispose_media_metadata") return disposeMediaMetadata(tx, context.organisationId, id, context.internalUserId!, decision.mediaId, value);
      if (decision.action === "dispose_evidence_annotation") return disposeEvidenceAnnotation(tx, context.organisationId, id, context.internalUserId!, decision.linkId, value);
      if (decision.action === "dispose_value") return disposeRecordedFieldValue(tx, context.organisationId, id, context.internalUserId!, decision.valueId, value);
      if (decision.action === "dispose_report") return disposeReportContent(tx, context.organisationId, id, context.internalUserId!, decision.reportId, value);
      if (decision.action === "dispose_proposal") return disposeFieldProposal(tx, context.organisationId, id, context.internalUserId!, decision.proposalId, value);
      if (decision.action === "dispose_task") return disposeAdviserTask(tx, context.organisationId, id, context.internalUserId!, decision.taskId, value);
      if (decision.action === "dispose_analysis") return disposeQuestionnaireAnalysis(tx, context.organisationId, id, context.internalUserId!, decision.documentId, value);
      if (decision.action === "dispose_media_analysis") return disposeMediaAnalysis(tx, context.organisationId, id, context.internalUserId!, decision.analysisId, value);
      return cancelReviewedSurveyFileRemoval(tx, context.organisationId, id, context.internalUserId!, value);
    });
    return ok({ ...result, persisted: true });
  } catch {
    return problem(409, "removal_decision_changed", "The file, permissions or removal decision changed. Reload and review the current state before retrying.");
  }
}
