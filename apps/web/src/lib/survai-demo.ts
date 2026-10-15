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
import { demoSurveyPack } from "./demo-survey";
import { demoIntelligence } from "./demo-intelligence";
import { demoPropertyHistory } from "./property-history";
import { demoClauses } from "./demo-wording";
import { formStateSource, generalKnowledgeSource, historySource, intelligenceSources } from "./survai-knowledge";
import { visitWeatherAssessment, type DailyForecast } from "./visit-risk";
import { fetchDailyForecast } from "./visit-forecast";
import { lookupPostcode } from "@surveynt/property-data";
import type { SurveyPack } from "./surveys";
import { decideWebProposal, verifyProposal } from "./survai-web-router";
import { groundedWebAnswer } from "./gemini-native";

type DemoAccess = { demo: boolean; organisationId?: string; role?: OrganisationRole; platformRole?: PlatformRole; mode: "firm" | "platform" };
type DemoSource = { id: string; label: string; href: string; data: unknown };
const credentialEnv = "SURVEYNT_CONNECTION_SECRET_GEMINI";
const recent: number[] = [];
let inFlight = 0;
const cached = new Map<string, { expires: number; response: Awaited<ReturnType<typeof conversationalAnswer>> }>();


const demoLabel = "Fictional demo record. Not a real property, forecast or register entry.";
/** Free evaluation services (Postcodes.io, Open-Meteo, Gemini search) for the stakeholder demo only. */
export const demoEvaluationServices = () => process.env.SURVEYNT_DEMO_EVALUATION_SERVICES === "true";
const livePoints = new Map<string, { expires: number; point: { latitude: number; longitude: number } | null }>();
const liveForecasts = new Map<string, { expires: number; forecast: DailyForecast | null }>();
async function postcodePoint(postcode: string) {
  const saved = livePoints.get(postcode);
  if (saved && saved.expires > Date.now()) return saved.point;
  const result = await lookupPostcode(postcode, { baseUrl: process.env.POSTCODES_IO_BASE_URL, timeoutMs: 5000 }).catch(() => null);
  const point = result?.status === "matched" ? { latitude: result.result.latitude, longitude: result.result.longitude } : null;
  livePoints.set(postcode, { expires: Date.now() + (point ? 24 * 3_600_000 : 5 * 60_000), point });
  return point;
}
/** Real forecast for a fictional visit's postcode area from the free Open-Meteo evaluation service, or null. */
async function liveDemoForecast(address: string, date: string): Promise<DailyForecast | null> {
  const property = properties.find(item => address.includes(item.address));
  if (!property || !demoEvaluationServices()) return null;
  const key = `${property.postcode}:${date}`, saved = liveForecasts.get(key);
  if (saved && saved.expires > Date.now()) return saved.forecast;
  let forecast: DailyForecast | null = null;
  try { const point = await postcodePoint(property.postcode); if (point) forecast = await fetchDailyForecast(process.env.SURVEYNT_DEMO_WEATHER_ENDPOINT ?? "https://api.open-meteo.com", point, date); } catch { forecast = null; }
  if (liveForecasts.size > 200) liveForecasts.clear();
  liveForecasts.set(key, { expires: Date.now() + (forecast ? 30 : 5) * 60_000, forecast });
  return forecast;
}
/** Fictional visits get a live forecast when evaluation services are enabled, otherwise a fixed labelled outlook. */
async function demoVisitsWithWeather(permitted: typeof jobs, now = new Date()) {
  const visits = demoVisits(permitted, now);
  return Promise.all(visits.map(async visit => {
    const data = visit.data as { visit: { date: string; service: string; address: string } };
    const live = await liveDemoForecast(data.visit.address, data.visit.date);
    if (!live) return visit;
    return { ...visit, label: visit.label.replace("fictional weather outlook", "live weather forecast"), data: { demo: true, visit: data.visit, forecast: live, assessment: visitWeatherAssessment(data.visit.service, live), source: "Open-Meteo free evaluation service (CC BY 4.0) for the postcode area of a fictional visit", retrievedAt: new Date().toISOString(), caveat: "Live forecast for a fictional visit date and postcode area. A forecast, not a certainty; the surveyor decides whether to proceed, adapt or rearrange." } };
  }));
}
/** A fixed fictional schedule and outlook so the weather-risk workflow can be explored safely. */
function demoVisits(permitted: typeof jobs, now = new Date()) {
  const outlooks: Record<string, Omit<DailyForecast, "date">> = {
    job_01: { precipitationSumMm: 32, precipitationProbabilityPercent: 95, windSpeedMaxKmh: 48, weatherCode: 65, temperatureMaxC: 11, temperatureMinC: 7 },
    job_03: { precipitationSumMm: 1, precipitationProbabilityPercent: 20, windSpeedMaxKmh: 18, weatherCode: 2, temperatureMaxC: 15, temperatureMinC: 8 },
    job_05: { precipitationSumMm: 6, precipitationProbabilityPercent: 75, windSpeedMaxKmh: 56, weatherCode: 63, temperatureMaxC: 12, temperatureMinC: 6 },
  };
  return permitted.flatMap((job, index) => {
    const outlook = outlooks[job.id];
    if (!outlook) return [];
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(now.getTime() + index * 86_400_000));
    const forecast = { date, ...outlook };
    return [{ id: `demo:forecast:${job.id}`, label: `${job.reference} · fictional weather outlook`, href: `jobs/${job.id}`, data: { demo: true, visit: { date, service: job.service, address: job.address }, forecast, assessment: visitWeatherAssessment(job.service, forecast), caveat: `${demoLabel} A forecast, not a certainty; the surveyor decides whether to proceed, adapt or rearrange.` } }];
  });
}
function demoPropertySources(propertyId: string): DemoSource[] {
  const property = properties.find((item) => item.id === propertyId);
  if (!property) return [];
  const label = (source: DemoSource) => ({ ...source, id: `demo:${source.id}`, data: { demo: true, note: demoLabel, ...(source.data as object) } });
  return [
    { id: `demo:property:${property.id}`, label: `${property.address}, ${property.postcode} · fictional property`, href: `properties/${property.id}`, data: { demo: true, ...property } },
    label(historySource(property.id, demoPropertyHistory)),
    ...intelligenceSources(property.id, demoIntelligence()).map(label),
  ];
}
async function demoJobSources(jobId: string, page: string, permitted: typeof jobs): Promise<DemoSource[]> {
  const job = permitted.find((item) => item.id === jobId);
  if (!job) return [];
  const property = properties.find((item) => job.address.includes(item.address));
  const pack = demoSurveyPack(job.id);
  const sources: DemoSource[] = [{ id: `demo:job:${job.id}`, label: `${job.reference} · fictional case`, href: `jobs/${job.id}`, data: { demo: true, ...job, fee: undefined } }];
  if (pack) { const form = formStateSource(pack as unknown as SurveyPack); sources.push({ ...form, id: `demo:${form.id}`, data: { demo: true, note: demoLabel, ...(form.data as object) } }); }
  sources.push(...(await demoVisitsWithWeather(permitted)).filter((visit) => visit.id === `demo:forecast:${job.id}`));
  if (property) sources.push(...demoPropertySources(property.id));
  if (page === "survey" || page === "job") sources.push(...demoClauses.filter((clause) => clause.status === "approved").slice(0, 8).map((clause) => ({ id: `demo:wording:${clause.id}`, label: `Practice wording · ${clause.title}`, href: "reports?view=wording", data: { demo: true, title: clause.title, element: clause.elementKey, purpose: clause.purpose, text: clause.body.slice(0, 600) } })));
  return sources;
}
/** This adapter contains only no-Clerk, fictional fixtures. It never queries production records. */
export async function demoSurvaiSources(access: DemoAccess, context: SurvaiPageContext, message = ""): Promise<DemoSource[]> {
 const state = await demoStore.snapshot();
 if (access.mode === "platform") {
  const counts = state.tenants.reduce<Record<string, number>>((totals, tenant) => { totals[tenant.status] = (totals[tenant.status] ?? 0) + 1; return totals; }, {});
  return [{ id: "demo:platform-status", label: "Fictional practice lifecycle totals", href: "/platform/tenants", data: { demo: true, counts, coverage: "Fictional tenant statuses only. No billing, incidents, learning settings or private practice records are supplied." } }];
 }
 const tenant = state.tenants.find(item => item.id === access.organisationId);
 if (!tenant) throw new GovernanceError(404, "demo_not_found", "The fictional practice is unavailable.");
 if (["finance", "billing", "quotes"].includes(context.page)) return [{ id: "demo:finance", label: "Local demo finance ledger (empty)", href: "finance", data: { demo: true, invoices: [], verifiedPayments: [], currencies: [], quotes: [], coverage: "The no-Clerk Finance page has no invoices or verified payment records. Outstanding balances are unknown, not confirmed as zero or absent. No amounts, balances, currency totals, overdue dates or subscriptions can be established. Do not substitute illustrative amounts or case fees." } }];
 if (["job", "survey", "property"].includes(context.page) && context.resourceId) {
  const permitted = scopedDemoJobs(jobs, access.role!);
  const selected = context.page === "property" ? demoPropertySources(context.resourceId) : await demoJobSources(context.resourceId, context.page, permitted);
  if (selected.length) return [generalKnowledgeSource, ...selected];
 }
 if (["job", "survey", "property", "customer"].includes(context.page)) return [{ id: "demo:selection", label: "Local demo record selection", href: context.page === "property" ? "properties" : context.page === "customer" ? "customers" : "jobs", data: { demo: true, selectedRecord: null, coverage: "This local demo does not supply a resolved selected record to the assistant. Do not infer a current case or include unrelated records." } }];
 if (context.page === "documents" || context.page === "reports") return [{ id: "demo:documents", label: "Local demo document coverage", href: "documents", data: { demo: true, documents: [], reportContents: [], coverage: "No authorised document contents or report findings are supplied in this local preview." } }];
 if (["settings", "governance", "services", "locations"].includes(context.page)) return [{ id: "demo:practice", label: "Fictional practice identity", href: "settings", data: { demo: true, name: tenant.name, status: tenant.status, coverage: "Practice identity only. No approvals, source configurations, subscriptions, coverage policies or credentials are supplied." } }];
 const permitted = scopedDemoJobs(jobs, access.role!);
 const sources: DemoSource[] = permitted.map(job => ({ id: `demo:job:${job.id}`, label: `${job.reference} · fictional case`, href: `jobs/${job.id}`, data: { ...job, demo: true, coverage: "Fictional case fixture. Relative target labels such as Today are not resolved appointment dates. No inspection evidence, professional findings or live location data are supplied." } }));
 if (["properties", "customers"].includes(context.page)) {
  const clients = new Set(permitted.map(job => job.client));
  sources.push({ id: "demo:linked-records", label: "Fictional linked customer and property records", href: context.page, data: { demo: true, properties: properties.filter(property => clients.has(property.client)), customers: state.clients.filter(client => client.organisationId === tenant.id && clients.has(client.displayName)).map(client => ({ id: client.id, name: client.displayName, kind: client.kind })) } });
 }
 if (["calendar", "availability", "routes", "fieldwork"].includes(context.page)) sources.push({ id: "demo:appointment-coverage", label: "Local demo appointment coverage", href: "calendar", data: { demo: true, appointments: [], coverage: "The calendar layout is illustrative and has no live, assignment-verified appointment data. Do not infer availability, clashes, access confirmation, traffic or travel time. Weather is limited to the fictional outlooks supplied." } });
 if (["overview", "calendar", "routes", "fieldwork", "jobs"].includes(context.page)) sources.push(...await demoVisitsWithWeather(permitted));
 // A question naming a fictional postcode or street resolves within the permitted demo properties.
 const asked = message.toLowerCase().replace(/\s+/g, " ");
 const permittedClients = new Set(permitted.map(job => job.client));
 for (const property of properties.filter(item => permittedClients.has(item.client) && (asked.includes(item.postcode.toLowerCase()) || asked.includes(item.address.toLowerCase()))).slice(0, 2)) sources.push(...demoPropertySources(property.id));
 sources.push(generalKnowledgeSource);
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
 const sources = await demoSurvaiSources(access, context, input.message);
 const action = survaiContextCopy(context, { mode: access.mode, role: access.role, platformRole: access.platformRole }).actions.some(item => item.question === input.message);
 const key = createHash("sha256").update(JSON.stringify({ model, access, context, question: input.message, sources })).digest("hex");
 const now = Date.now(), hit = action ? cached.get(key) : undefined;
 if (hit && hit.expires > now) return { message: { role: "assistant", ...hit.response, demo: true, model, webProposal: demoWebProposal(access, context, input.message, hit.response, sources) }, cached: true };
 while (recent.length && recent[0] <= now - 60_000) recent.shift();
 // Warm-instance bounds and canned-task caching reduce costs; provider quotas remain the global limit.
 if (inFlight >= 2 || recent.length >= 20) throw new GovernanceError(429, "demo_rate_limit", "The demonstration is busy. Please try again in a minute.");
 recent.push(now); inFlight++;
 try {
  const connection = { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", credentialEnv, providerKey: "gemini" } as typeof platformConnections.$inferSelect;
  const answer = await conversationalAnswer(connection, model, input.message, sources, [], { page: context, effectiveRole: access.role ?? access.platformRole ?? "platform" });
  if (action) { if (cached.size >= 100) cached.clear(); cached.set(key, { expires: now + 5 * 60_000, response: answer }); }
  return { message: { role: "assistant", ...answer, demo: true, model, webProposal: demoWebProposal(access, context, input.message, answer, sources) }, cached: false };
 } finally { inFlight--; }
}

const demoUser = (access: DemoAccess) => ({ organisationId: access.organisationId ?? "demo", userId: `demo:${access.role ?? access.platformRole ?? "user"}` });
/** Confirmed web search is offered in the demo only with free evaluation services switched on. */
const demoWebEnabled = (access: DemoAccess) => access.mode === "firm" && demoEvaluationServices() && process.env.SURVEYNT_DEMO_AI_ENABLED === "true" && Boolean(process.env[credentialEnv]);
function demoWebProposal(access: DemoAccess, context: SurvaiPageContext, question: string, answer: Awaited<ReturnType<typeof conversationalAnswer>>, sources: DemoSource[]) {
 return decideWebProposal({ enabled: demoWebEnabled(access), coverage: answer.coverage, suggestedQuery: answer.webQuery, question, page: context.page, sources, ...demoUser(access) });
}

/** Runs a user-confirmed demo web search through Gemini's native endpoint with Google Search grounding. Nothing is stored. */
export async function sendDemoWebAnswer(access: DemoAccess, input: { token: string }) {
 if (!access.demo || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY) throw new GovernanceError(403, "demo_only", "Fictional preview assistance cannot be used for authenticated production records.");
 if (!demoWebEnabled(access)) throw new GovernanceError(503, "web_search_unavailable", "Web search is not enabled for this demonstration.");
 const query = verifyProposal(input.token, demoUser(access));
 if (!query) throw new GovernanceError(410, "proposal_expired", "This search suggestion has expired. Ask SurvAI again.");
 const model = process.env.SURVEYNT_DEMO_AI_MODEL ?? "gemini-3.1-flash-lite";
 const now = Date.now();
 while (recent.length && recent[0] <= now - 60_000) recent.shift();
 if (inFlight >= 2 || recent.length >= 20) throw new GovernanceError(429, "demo_rate_limit", "The demonstration is busy. Please try again in a minute.");
 recent.push(now); inFlight++;
 try {
  const answer = await groundedWebAnswer({ credentialEnv, model, query });
  return { message: { role: "assistant", content: answer.content, citations: answer.citations, searchSuggestions: answer.searchSuggestions, web: true, query, demo: true, model } };
 } finally { inFlight--; }
}
