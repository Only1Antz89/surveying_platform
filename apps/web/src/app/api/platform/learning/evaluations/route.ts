import { platformApiContext } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { evaluationInput, runRetrievalEvaluation } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Runs the held-out retrieval-baseline evaluation on the active release and stores the result. */
export async function POST(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  const parsed = await parseBody(request, evaluationInput);
  if (!parsed.success) return problem(400, "invalid_request", "The evaluation options are invalid.", parsed.error.flatten());
  return learningRoute(() => runRetrievalEvaluation(operator, parsed.data));
}
