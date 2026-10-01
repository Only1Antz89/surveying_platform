import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { loadPropertyIntelligence } from "@/lib/property-intelligence";

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence/environment">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) return ok([], { demo: true });
  const data = await loadPropertyIntelligence(context.organisationId, id);
  return data ? ok(data.snapshots.filter((snapshot) => snapshot.category === "environment")) : problem(404, "property_not_found", "The property could not be found.");
}
