import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { loadModelRegister, proposeModel, registerInput } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** The platform model register (empty until a provider is chosen). */
export async function GET() {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.demo) return ok([], { demo: true });
  return ok(await loadModelRegister());
}

/** Proposes a model for evaluation. It cannot be used until approved with recorded evaluation results. */
export async function POST(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, registerInput);
  if (!parsed.success) return problem(400, "invalid_request", "The model entry is invalid.", parsed.error.flatten());
  if (operator.demo) return ok({ ...parsed.data, status: "proposed" }, { demo: true, persisted: false });
  return governed(() => proposeModel(operator, parsed.data));
}
