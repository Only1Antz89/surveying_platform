import { platformApiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { canViewLearning, loadLearningConsole } from "@/lib/learning-admin";

export const runtime = "nodejs";

/** Programme state, policy versions, queue counts and the privacy review queue. Firm identity is never included. */
export async function GET() {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (!canViewLearning(operator.role)) return problem(403, "forbidden", "A shared-learning role is required.");
  if (operator.demo) return ok({ demo: true }, { demo: true });
  return ok(await loadLearningConsole());
}
