import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { after } from "next/server";
import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { analyseStoredMedia } from "@/lib/media-analysis";
import { storeSurveyMedia } from "@/lib/surveys";

export const runtime = "nodejs";
export const maxDuration = 60;

const metadata = z.object({
  clientGeneratedId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
  capturedAt: z.iso.datetime().nullable().optional(),
  captureContext: z.object({ sectionKey: z.string().max(60).optional(), elementKey: z.string().max(60).optional(), locationLabel: z.string().max(120).optional(), caption: z.string().max(500).optional() }).optional(),
});

/** Uploads one original photo or document (multipart: `file` plus JSON `metadata`). Retries are idempotent. */
export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/media">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const professionalDenial = professionalApiGuard(request, context);
  if (professionalDenial) return professionalDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot upload survey evidence.");
  const { id } = await route.params;
  if (context.demo) return problem(503, "storage_not_configured", "Demo workspace: photos are kept on this device only and are not uploaded.");
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const meta = metadata.safeParse(JSON.parse(String(form?.get("metadata") ?? "{}")));
  if (!(file instanceof File) || !meta.success) return problem(400, "invalid_request", "Send one file with its metadata.");
  const result = await storeSurveyMedia({ organisationId: context.organisationId, internalUserId: context.internalUserId, role: context.role, canRecordSurvey: context.canRecordSurvey, canApproveReports: context.canApproveReports }, id, { file, clientGeneratedId: meta.data.clientGeneratedId, capturedAt: meta.data.capturedAt, captureContext: meta.data.captureContext });
  if (result.kind === "missing") return problem(404, "survey_not_found", "The survey could not be found.");
  if (result.kind === "not_configured") return problem(503, "storage_not_configured", result.message);
  if (result.kind === "invalid") return problem(422, "media_rejected", result.message);
  const { media } = result;
  // Quality hints and document facts are computed after the response; the daily sweep catches any that do not run.
  if (!result.duplicate) after(() => analyseStoredMedia({ organisationId: context.organisationId }, media.id).then(() => undefined, () => undefined));
  return ok({ id: media.id, kind: media.kind, contentType: media.contentType, byteSize: media.byteSize, sha256: media.sha256, clientGeneratedId: media.clientGeneratedId, createdAt: media.createdAt.toISOString() }, { duplicate: result.duplicate });
}
