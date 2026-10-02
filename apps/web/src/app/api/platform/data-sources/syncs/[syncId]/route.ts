import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { activateDataSourceSync, canOperateDataSources } from "@/lib/data-source-admin";

export const runtime = "nodejs";

/** Activates a staged, validated dataset version (atomic; the previous version is kept for rollback) and clears cached responses. */
export async function POST(request: Request, route: RouteContext<"/api/platform/data-sources/syncs/[syncId]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (!canOperateDataSources(operator.role)) return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, z.object({ action: z.literal("activate") }));
  if (!parsed.success) return problem(400, "invalid_request", "Only activation is supported here.");
  const { syncId } = await route.params;
  if (operator.demo) return ok({}, { demo: true, persisted: false });
  if (!z.uuid().safeParse(syncId).success) return problem(404, "sync_not_found", "The dataset version could not be found.");
  try {
    return ok(await activateDataSourceSync(operator, syncId));
  } catch (reason) {
    if (reason instanceof Error && /completed, validated|not found|cannot be activated/i.test(reason.message)) return problem(422, "activation_refused", reason.message);
    throw reason;
  }
}
