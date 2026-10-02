import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { applyDataSourceAction, canOperateDataSources, OperationRefused } from "@/lib/data-source-admin";

export const runtime = "nodejs";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), notes: z.string().trim().min(20).max(2000) }),
  z.object({ action: z.literal("disable") }),
  z.object({ action: z.literal("release_checked"), notes: z.string().trim().min(10).max(2000) }),
  z.object({ action: z.literal("probe") }),
  z.object({ action: z.literal("rollback"), layer: z.string().max(60).default("") }),
]);

/** Enable after verification, disable, record a release check, probe health or roll back a layer. Audited. */
export async function POST(request: Request, route: RouteContext<"/api/platform/data-sources/[key]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (!canOperateDataSources(operator.role)) return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, action);
  if (!parsed.success) return problem(400, "invalid_request", "The data source action is invalid.", parsed.error.flatten());
  const { key } = await route.params;
  if (operator.demo) return ok({}, { demo: true, persisted: false });
  try {
    return ok(await applyDataSourceAction(operator, key, parsed.data));
  } catch (reason) {
    if (reason instanceof OperationRefused || (reason instanceof Error && /no earlier version|no longer available/.test(reason.message))) return problem(422, "operation_refused", reason.message);
    throw reason;
  }
}
