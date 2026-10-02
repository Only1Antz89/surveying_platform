import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { setModelStatus } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** Approves (with evaluation results), suspends or retires a registered model. Suspension blocks use immediately. */
export async function POST(request: Request, route: RouteContext<"/api/platform/ai-models/[id]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, z.object({ status: z.enum(["approved", "suspended", "retired"]), evaluationSummary: z.record(z.string(), z.unknown()).optional() }));
  if (!parsed.success) return problem(400, "invalid_request", "The status change is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (operator.demo) return ok({ id, status: parsed.data.status }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The model could not be found.");
  return governed(() => setModelStatus(operator, id, parsed.data));
}
