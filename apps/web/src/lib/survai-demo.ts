import "server-only";
import { createHash } from "node:crypto";
import type { OrganisationRole, PlatformRole } from "@surveynt/domain";
import type { platformConnections } from "@surveynt/db";
import { jobs, properties } from "./demo-data";
import { demoStore } from "./demo-store";
import { scopedDemoJobs } from "./workspace-scope";
import { survaiContextCopy, survaiContextError, type SurvaiPageContext } from "./survai-context";
import { conversationalAnswer } from "./surveyant-chat";
import { GovernanceError } from "./ai-governance";

type DemoAccess = { demo: boolean; organisationId?: string; role?: OrganisationRole; platformRole?: PlatformRole; mode: "firm" | "platform" };
type DemoSource = { id: string; label: string; href: string; data: unknown };
const credentialEnv = "SURVEYNT_CONNECTION_SECRET_GEMINI";
const recent: number[] = [];
let inFlight = 0;
const cached = new Map<string, { expires: number; response: Awaited<ReturnType<typeof conversationalAnswer>> }>();

/** This adapter contains only no-Clerk, fictional fixtures. It never queries production records. */
export async function demoSurvaiSources(access: DemoAccess, context: SurvaiPageContext): Promise<DemoSource[]> {
 const state = await demoStore.snapshot();
 if (access.mode === "platform") {
  const counts = state.tenants.reduce<Record<string, number>>((totals, tenant) => { totals[tenant.status] = (totals[tenant.status] ?? 0) + 1; return totals; }, {});
  return [{ id: "demo:platform-status", label: "Fictional practice lifecycle totals", href: "/platform/tenants", data: { demo: true, counts, coverage: "Fictional tenant statuses only. No billing, incidents, learning settings or private practice records are supplied." } }];
 }
 const tenant = state.tenants.find(item => item.id === access.organisationId);
 if (!tenant) throw new GovernanceError(404, "demo_not_found", "The fictional practice is unavailable.");
 if (["finance", "billing", "quotes"].includes(context.page)) return [{ id: "demo:finance", label: "Local demo finance ledger (empty)", href: "finance", data: { demo: true, invoices: [], verifiedPayments: [], currencies: [], quotes: [], coverage: "The no-Clerk Finance page has no invoices or verified payment records. No amounts, balances, currency totals, overdue dates or subscriptions can be established. Do not substitute illustrative amounts or case fees." } }];
 if (["job", "survey", "property", "customer"].includes(context.page)) return [{ id: "demo:selection", label: "Local demo record selection", href: context.page === "property" ? "properties" : context.page === "customer" ? "customers" : "jobs", data: { demo: true, selectedRecord: null, coverage: "This local demo does not supply a resolved selected record to the assistant. Do not infer a current case or include unrelated records." } }];
 if (context.page === "documents" || context.page === "reports") return [{ id: "demo:documents", label: "Local demo document coverage", href: "documents", data: { demo: true, documents: [], reportContents: [], coverage: "No authorised document contents or report findings are supplied in this local preview." } }];
 if (["settings", "governance", "services", "locations"].includes(context.page)) return [{ id: "demo:practice", label: "Fictional practice identity", href: "settings", data: { demo: true, name: tenant.name, status: tenant.status, coverage: "Practice identity only. No approvals, source configurations, subscriptions, coverage policies or credentials are supplied." } }];
 const permitted = scopedDemoJobs(jobs, access.role!);
 const sources: DemoSource[] = permitted.map(job => ({ id: `demo:job:${job.id}`, label: `${job.reference} · fictional case`, href: `jobs/${job.id}`, data: { ...job, demo: true, coverage: "Fictional case fixture. Relative target labels such as Today are not resolved appointment dates. No inspection evidence, professional findings or live location data are supplied." } }));
 if (["properties", "customers"].includes(context.page)) {
  const clients = new Set(permitted.map(job => job.client));
  sources.push({ id: "demo:linked-records", label: "Fictional linked customer and property records", href: context.page, data: { demo: true, properties: properties.filter(property => clients.has(property.client)), customers: state.clients.filter(client => client.organisationId === tenant.id && clients.has(client.displayName)).map(client => ({ id: client.id, name: client.displayName, kind: client.kind })) } });
 }
 if (["calendar", "availability", "routes", "fieldwork"].includes(context.page)) sources.push({ id: "demo:appointment-coverage", label: "Local demo appointment coverage", href: "calendar", data: { demo: true, appointments: [], coverage: "The calendar layout is illustrative and has no live, assignment-verified appointment data for these case excerpts. Do not infer availability, clashes, visit dates, access confirmation, weather, traffic or travel time." } });
 if (context.page === "performance") sources.push({ id: "demo:performance-coverage", label: "Local demo reporting coverage", href: "performance", data: { demo: true, historicalSeries: [], financialRecords: [], coverage: "No historical trends or financial records are supplied. Current fictional case stages are the only operational evidence." } });
 return sources;
}

/** Explicitly enabled for the public fictional preview; production continues through sendChat/platformChat. */
export async function sendDemoSurvai(access: DemoAccess, input: { message: string; pageContext?: SurvaiPageContext }) {
 if (!access.demo || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY) throw new GovernanceError(403, "demo_only", "Fictional preview assistance cannot be used for authenticated production records.");
 const context = input.pageContext ?? { page: access.mode === "platform" ? "platform-practices" : "overview" };
 const denied = survaiContextError(context, { mode: access.mode, role: access.role, platformRole: access.platformRole, demo: true });
 if (denied) throw new GovernanceError(denied.status, "page_context_forbidden", denied.message);
 if (process.env.SURVEYNT_DEMO_AI_ENABLED !== "true" || !process.env[credentialEnv]) throw new GovernanceError(503, "not_configured", "This local demo has no enabled SurvAI provider. No records were sent to an AI service.");
 const model = process.env.SURVEYNT_DEMO_AI_MODEL ?? "gemini-3.1-flash-lite";
 if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new GovernanceError(503, "invalid_model", "The configured demo model is unavailable.");
 const sources = await demoSurvaiSources(access, context);
 const action = survaiContextCopy(context, { mode: access.mode, role: access.role, platformRole: access.platformRole }).actions.some(item => item.question === input.message);
 const key = createHash("sha256").update(JSON.stringify({ model, access, context, question: input.message, sources })).digest("hex");
 const now = Date.now(), hit = action ? cached.get(key) : undefined;
 if (hit && hit.expires > now) return { message: { role: "assistant", ...hit.response, demo: true, model }, cached: true };
 while (recent.length && recent[0] <= now - 60_000) recent.shift();
 // Warm-instance bounds and canned-task caching reduce costs; provider quotas remain the global limit.
 if (inFlight >= 2 || recent.length >= 20) throw new GovernanceError(429, "demo_rate_limit", "The demonstration is busy. Please try again in a minute.");
 recent.push(now); inFlight++;
 try {
  const connection = { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", credentialEnv, providerKey: "gemini" } as typeof platformConnections.$inferSelect;
  const answer = await conversationalAnswer(connection, model, input.message, sources, [], { page: context, effectiveRole: access.role ?? access.platformRole ?? "platform" });
  if (action) { if (cached.size >= 100) cached.clear(); cached.set(key, { expires: now + 5 * 60_000, response: answer }); }
  return { message: { role: "assistant", ...answer, demo: true, model }, cached: false };
 } finally { inFlight--; }
}
