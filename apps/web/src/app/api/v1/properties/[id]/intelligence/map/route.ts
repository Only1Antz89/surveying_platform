import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { demoPropertyMap, loadPropertyMap } from "@/lib/property-map";

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence/map">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo) return ok(demoPropertyMap, { demo: true, deprecated: true, canonical: `/api/v1/properties/${id}/map` });
  const data = await loadPropertyMap(context, id);
  return data ? ok(data, { deprecated: true, canonical: `/api/v1/properties/${id}/map` }) : problem(404, "property_not_found", "The property could not be found.");
}
