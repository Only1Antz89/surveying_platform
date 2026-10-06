import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { earlierPhotosForElement } from "@/lib/photo-history";

export const runtime = "nodejs";

const key = z.string().regex(/^[a-z][a-z0-9_]*$/).max(60);

/** Earlier photos of one element from this firm's previous surveys of the same property, for manual comparison only. */
export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]/photo-history">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const professionalDenial = professionalApiGuard(request, context);
  if (professionalDenial) return professionalDenial;
  const { id } = await route.params;
  const url = new URL(request.url);
  const query = z.object({ section: key, element: key }).safeParse({ section: url.searchParams.get("section"), element: url.searchParams.get("element") });
  if (!query.success) return problem(400, "invalid_request", "A section and element are required.");
  if (context.demo) return ok([], { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  const photos = await earlierPhotosForElement(context, id, query.data.section, query.data.element);
  return photos ? ok(photos, { note: "Compare on site. Any difference is a possible change, not a finding." }) : problem(404, "survey_not_found", "The survey could not be found.");
}
