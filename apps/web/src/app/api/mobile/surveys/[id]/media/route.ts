import { z } from "zod";
import { ok, problem } from "@/lib/api";
import { mobileContext } from "@/lib/mobile-access";
import { surveyContextFor } from "@/lib/mobile-capture";
import { applySyncOperations, storeSurveyMedia } from "@/lib/surveys";

export const runtime = "nodejs";
const metadata = z.object({ clientGeneratedId: z.string().regex(/^media_[a-z0-9]{8,64}$/), capturedAt: z.iso.datetime().nullable().optional(), sectionKey: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60), elementKey: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60), note: z.string().trim().max(1000).optional() });

/** Stores a site photo as an immutable original and links it to its survey element. Retries are idempotent. */
export async function POST(request: Request, route: RouteContext<"/api/mobile/surveys/[id]/media">) {
  const context = await mobileContext(request);
  if (!context) return problem(401, "unauthorised", "An authorised mobile surveyor session is required.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const parsed = metadata.safeParse(JSON.parse(String(form?.get("metadata") ?? "null")));
  if (!(file instanceof File) || !parsed.success) return problem(422, "invalid_upload", "Attach a photo with its survey element.");
  const surveyContext = surveyContextFor(context);
  const stored = await storeSurveyMedia(surveyContext, id, { file, clientGeneratedId: parsed.data.clientGeneratedId, capturedAt: parsed.data.capturedAt ?? null, captureContext: { sectionKey: parsed.data.sectionKey, elementKey: parsed.data.elementKey, source: "mobile" } });
  if (stored.kind === "missing") return problem(404, "survey_not_found", "The survey could not be found or is not assigned to you.");
  if (stored.kind === "not_configured") return problem(503, "storage_not_configured", stored.message);
  if (stored.kind === "invalid") return problem(422, "invalid_upload", stored.message);
  const [link] = await applySyncOperations(surveyContext, id, [{ type: "link_evidence", operationId: `link_${parsed.data.clientGeneratedId}`, target: { type: "element", element: { sectionKey: parsed.data.sectionKey, elementKey: parsed.data.elementKey, locationLabel: "" } }, evidence: { type: "media", id: parsed.data.clientGeneratedId }, ...(parsed.data.note ? { note: parsed.data.note } : {}) }]);
  return ok({ mediaId: stored.media.id, duplicate: "duplicate" in stored ? stored.duplicate : false, link });
}
