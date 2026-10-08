import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { demoPropertyMap, loadPropertyMap } from "@/lib/property-map";

export const runtime = "nodejs";

/** Bounded, simplified reference features around the property for the map, with per-layer attribution and caveats. */
export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/map">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo) return ok(demoPropertyMap, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "property_not_found", "The property could not be found.");
  const view = await loadPropertyMap(context, id);
  return view ? ok(view, { generatedAt: new Date().toISOString() }) : problem(404, "property_not_found", "The property could not be found.");
}
