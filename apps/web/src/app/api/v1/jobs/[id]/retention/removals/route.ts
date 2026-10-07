import { z } from "zod";
import { createDatabase, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok, parseBody, problem } from "@/lib/api";
import { cancelReviewedSurveyFileRemoval, requestReviewedSurveyFileRemoval } from "@/lib/survey-file-removal-request";

import { disposeQuestionnaireAnalysis } from "@/lib/survey-file-questionnaire-disposition";

import { disposeMediaAnalysis } from "@/lib/survey-file-media-analysis-disposition";

const common = { reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) };
const input = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("request"), requestId: z.uuid(), reviewVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...common, action: z.literal("dispose_media_analysis"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), analysisId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("dispose_analysis"), id: z.uuid(), manifestVersion: z.string().regex(/^[a-f0-9]{64}$/), documentId: z.uuid() }).strict(),
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
    const result = await withTenant(createDatabase(), context.organisationId, async tx => {
      if (decision.action === "request") {
        const value = { requestId: decision.requestId, reviewVersion: decision.reviewVersion, reason: decision.reason, confirmed: decision.confirmed };
        return requestReviewedSurveyFileRemoval(tx, context.organisationId, id, context.internalUserId!, value);
      }
      const value = { id: decision.id, manifestVersion: decision.manifestVersion, reason: decision.reason, confirmed: decision.confirmed };
      if (decision.action === "dispose_analysis") return disposeQuestionnaireAnalysis(tx, context.organisationId, id, context.internalUserId!, decision.documentId, value);
      if (decision.action === "dispose_media_analysis") return disposeMediaAnalysis(tx, context.organisationId, id, context.internalUserId!, decision.analysisId, value);
      return cancelReviewedSurveyFileRemoval(tx, context.organisationId, id, context.internalUserId!, value);
    });
    return ok({ ...result, persisted: true });
  } catch {
    return problem(409, "removal_decision_changed", "The file, permissions or removal decision changed. Reload and review the current state before retrying.");
  }
}
