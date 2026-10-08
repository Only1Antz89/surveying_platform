import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { demoPropertyHistory, loadPropertyHistory } from "@/lib/property-history";

export const runtime = "nodejs";

/** Property timeline: linked sales, certificates, listings and designations, plus the firm's own job and survey events. */
export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/history">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo) return ok(demoPropertyHistory, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "property_not_found", "The property could not be found.");
  const history = await loadPropertyHistory(context, id);
  return history ? ok(history, { generatedAt: new Date().toISOString() }) : problem(404, "property_not_found", "The property could not be found.");
}
