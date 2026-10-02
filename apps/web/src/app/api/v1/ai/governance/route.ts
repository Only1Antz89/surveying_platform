import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { loadAiGovernance } from "@/lib/ai-governance";

export const runtime = "nodejs";

const demoGovernance = { providerConfigured: false, settings: { aiFeaturesEnabled: false, permittedUses: [], disclosureText: null, disclosureVersion: 0, version: 0 }, assessments: [], incidents: [], approvedModels: [] };

/** The firm's AI settings, risk assessments, incidents and the platform's approved models. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (context.demo) return ok(demoGovernance, { demo: true });
  return ok(await loadAiGovernance(context));
}
