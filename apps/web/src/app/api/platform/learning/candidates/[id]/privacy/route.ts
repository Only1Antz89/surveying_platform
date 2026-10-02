import { z } from "zod";
import { privacyDecisionSchema } from "@surveynt/learning";
import { platformApiContext } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { recordPrivacyDecision } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** A privacy reviewer approves (every check confirmed) or rejects (with a reason) a sanitised candidate. */
export async function POST(request: Request, route: RouteContext<"/api/platform/learning/candidates/[id]/privacy">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "privacy_reviewer") return problem(403, "forbidden", "Only privacy reviewers can make privacy decisions.");
  const parsed = await parseBody(request, privacyDecisionSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The privacy decision is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The candidate could not be found.");
  return learningRoute(() => recordPrivacyDecision(operator, id, parsed.data));
}
