import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { canManageLearningPolicy, policyInput, savePolicyDraft } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Edits a draft policy version; published versions never change. */
export async function PATCH(request: Request, route: RouteContext<"/api/platform/learning/policies/[id]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (!canManageLearningPolicy(operator.role)) return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, policyInput);
  if (!parsed.success) return problem(400, "invalid_request", "The policy draft is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (operator.demo) return ok(parsed.data, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The policy version could not be found.");
  return learningRoute(() => savePolicyDraft(operator, parsed.data, id));
}
