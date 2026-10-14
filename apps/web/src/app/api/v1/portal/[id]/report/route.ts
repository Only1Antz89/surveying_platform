import { ok, problem } from "@/lib/api";
import { portalReport } from "@/lib/client-portal";
import { portalCredential, portalFailure } from "@/lib/portal-route";

/** The issued report, for reading online. */
export async function GET(request: Request, route: RouteContext<"/api/v1/portal/[id]/report">) {
  const { id } = await route.params;
  if (id === "demo") return problem(409, "report_unavailable", "In this demonstration the report is shown once a fictional case is issued.");
  try { return ok(await portalReport(portalCredential(request, id))); } catch (error) { return portalFailure(error); }
}
