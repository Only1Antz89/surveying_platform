import { platformApiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { loadAssistantMetrics } from "@/lib/ai-governance";

export const runtime = "nodejs";

/** Platform-wide assistant and operations totals. No firm is named. */
export async function GET() {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.demo) return ok(null, { demo: true });
  return ok(await loadAssistantMetrics());
}
