import { ok } from "@/lib/api";
import { portalView } from "@/lib/client-portal";
import { portalCredential, portalFailure } from "@/lib/portal-route";
import { demoPortalView } from "@/lib/demo-portal";

/** Everything the client portal shows for one job. */
export async function GET(request: Request, route: RouteContext<"/api/v1/portal/[id]">) {
  const { id } = await route.params;
  if (id === "demo") return ok(demoPortalView(), { demo: true });
  try { return ok(await portalView(portalCredential(request, id))); } catch (error) { return portalFailure(error); }
}
