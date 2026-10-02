import { platformApiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { demoDataSourceView, loadDataSourceAdmin } from "@/lib/data-source-admin";

export const runtime = "nodejs";

/** Source register with enablement, active versions per layer, import history, freshness and health. */
export async function GET() {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.demo) return ok(demoDataSourceView(), { demo: true });
  return ok(await loadDataSourceAdmin());
}
