import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { loadPropertyMap } from "@/lib/property-intelligence";

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence/map">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) return ok({ type: "FeatureCollection", features: [] }, { demo: true });
  const data = await loadPropertyMap(context.organisationId, id);
  return data ? ok(data) : problem(404, "property_not_found", "The property could not be found.");
}
