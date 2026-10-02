import { z } from "zod";
import { technicalDecisionSchema } from "@surveynt/learning";
import { platformApiContext } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { recordTechnicalDecision } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** A technical reviewer writes the generalised shared case (approve) or rejects with a reason. */
export async function POST(request: Request, route: RouteContext<"/api/platform/learning/candidates/[id]/technical">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "technical_reviewer") return problem(403, "forbidden", "Only technical reviewers can make surveying review decisions.");
  const parsed = await parseBody(request, technicalDecisionSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The review is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The candidate could not be found.");
  return learningRoute(() => recordTechnicalDecision(operator, id, parsed.data));
}
