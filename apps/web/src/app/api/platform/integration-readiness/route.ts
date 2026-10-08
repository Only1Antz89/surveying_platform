import { platformApiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { integrationReadiness } from "@/lib/capabilities";
import { canManagePlatformIntegrations } from "@/lib/integration-access";
export async function GET() {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "Surveynt administrator access is required.");
  if (!canManagePlatformIntegrations(operator.role)) return problem(403, "forbidden", "Only Surveynt administrators manage platform integrations.");
  return ok(integrationReadiness(operator.demo).map(row => ({ ...row, action: row.key === "hmlr" || row.key === "epc" ? "Open source administration" : "Review secure deployment configuration", connectHref: row.key === "hmlr" || row.key === "epc" ? "/platform/data-sources" : undefined })), { demo: operator.demo });
}
