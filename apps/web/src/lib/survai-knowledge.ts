import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, ne, or } from "drizzle-orm";
import { appointments, createDatabase, jobs, properties, surveys, wordingClauses, withTenant } from "@surveynt/db";
import type { OrganisationRole } from "@surveynt/domain";
import { assignedJobScope, assignedPropertyScope } from "./workspace-scope";
import { loadPropertyIntelligence, type PropertyIntelligence } from "./intelligence";
import { loadPropertyHistory, type PropertyHistory } from "./property-history";
import { readSurveyPack, type SurveyPack } from "./surveys";
import { completionReportFromPack } from "./completion-input";
import { approvedClauses } from "./wording";
import { searchAddresses } from "./property-identity";
import { visitForecast, type VisitForecast } from "./visit-forecast";
import { visitWeatherAssessment } from "./visit-risk";
import type { SurvaiPageContext } from "./survai-context";

// SurvAI's knowledge layer. Each source is a bounded, labelled excerpt that SurvAI
// must cite. Every source is read with the requesting user's effective access and
// carries a stable id so saved answers can be re-authorised later.

export type KnowledgeSource = { id: string; label: string; href: string; data: unknown };
export type KnowledgeContext = { organisationId: string; internalUserId: string | null; role: OrganisationRole };

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const postcodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const clip = (value: string | null | undefined, length = 400) => value ? value.length > length ? `${value.slice(0, length)}…` : value : null;

/** General knowledge is allowed only when labelled; it never stands in for the practice's records. */
export const generalKnowledgeSource: KnowledgeSource = {
  id: "general:professional-knowledge", label: "General surveying knowledge (not from your records)", href: "#general",
  data: { kind: "general_knowledge", rules: "Use only for general questions about surveying practice, construction, defects, terminology or process. Introduce any such content with 'General guidance, not from your records:'. Do not state RICS requirements, legislation, prices or dates as current fact; advise checking the current official guidance. Never use this source for facts about a specific property, case, client or person." },
};

/** RICS-style form state: what is recorded, what is missing and what is waiting for review. */
export function formStateSource(pack: SurveyPack): KnowledgeSource {
  const report = completionReportFromPack(pack);
  const recorded = new Set(pack.values.map((value) => value.fieldPath));
  const sections = pack.template.sections.map((section) => {
    const elements = section.elements.map((element) => {
      const record = pack.elements.find((item) => item.sectionKey === section.key && item.elementKey === element.key);
      const rating = pack.values.find((value) => value.fieldPath === `${section.key}.${element.key}.condition_rating`)?.value as { value?: unknown } | undefined;
      return { element: element.label, key: `${section.key}.${element.key}`, inspectionStatus: record?.inspectionStatus ?? "not_started", limitation: clip(record?.limitationReason, 200), conditionRating: rating?.value ?? null, fieldsRecorded: element.fields.filter((field) => recorded.has(`${section.key}.${element.key}.${field.key}`)).length, fields: element.fields.length };
    });
    return { section: section.label, key: section.key, elements };
  });
  const failing = report?.items.filter((item) => item.status === "fail") ?? [];
  return {
    id: `form:${pack.survey.id}`, label: `${pack.job.reference} · ${pack.template.title} form state`, href: `jobs/${pack.survey.jobId}/survey`,
    data: {
      template: { title: pack.template.title, version: pack.template.version, serviceLevel: pack.survey.serviceLevel, jurisdiction: pack.survey.jurisdiction },
      status: pack.survey.status,
      completion: report ? { ready: report.ready, hardGateFailures: report.hardGateFailures, advisoryFailures: report.advisoryFailures, outstanding: failing.slice(0, 30).map((item) => ({ title: item.title, severity: item.severity, category: item.category, fieldPath: item.fieldPath, element: item.elementKey, detail: clip(item.detail, 200) })) } : "No completion checklist exists for this template.",
      sections,
      pendingSuggestions: pack.proposals.slice(0, 20).map((proposal) => ({ fieldPath: proposal.fieldPath, origin: proposal.originClass, limitations: proposal.limitations })),
      openTasks: pack.tasks.filter((task) => task.status !== "resolved" && task.status !== "dismissed").slice(0, 20).map((task) => ({ kind: task.kind, title: task.title, element: task.elementKey, fieldPath: task.fieldPath })),
      coverage: "Form structure, recorded field counts, condition ratings and completion checks. Observation text and professional judgements are the surveyor's; suggestions remain unreviewed until accepted.",
    },
  };
}

export function intelligenceSources(propertyId: string, intelligence: PropertyIntelligence): KnowledgeSource[] {
  return intelligence.categories.slice(0, 20).map((category) => ({
    id: `property-intel:${propertyId}:${category.sourceKey}:${category.category}`,
    label: `${intelligence.sources.find((source) => source.key === category.sourceKey)?.name ?? category.sourceKey} · ${category.category}`,
    href: `properties/${propertyId}?tab=intelligence`,
    data: {
      status: category.status, informationClass: category.informationClass, coverage: category.coverage, message: category.message, retrievedAt: category.retrievedAt, datasetVersion: category.datasetVersion,
      stale: category.stale, newerDataAvailable: category.newerDataAvailable, licence: category.licence,
      records: (category.records ?? []).slice(0, 5).map((record) => ({ data: JSON.stringify(record.data).slice(0, 1200), confidence: record.confidence, matchMethod: record.matchMethod, sourceUpdatedAt: record.sourceUpdatedAt })),
      caveat: "External and indicative records. 'No record found' is not proof of absence; check coverage and freshness. Not a professional finding.",
    },
  }));
}

export function historySource(propertyId: string, history: PropertyHistory): KnowledgeSource {
  return {
    id: `history:${propertyId}`, label: "Property history timeline", href: `properties/${propertyId}?tab=history`,
    data: {
      events: history.events.slice(0, 40).map((event) => ({ kind: event.kind, title: event.title, detail: clip(event.detail, 300), eventDate: event.eventDate, publishedDate: event.publishedDate, origin: event.origin, source: event.sourceKey, informationClass: event.informationClass, stale: event.stale })),
      coverage: history.coverage,
      caveat: "Sales, certificates and designations come from external registers with their own coverage and delays. Earlier firm surveys are historical context, not current findings.",
    },
  };
}

/** Bounded property context: intelligence, history and identity, for a property the user may see. */
async function propertyContext(context: KnowledgeContext, propertyId: string, label: string): Promise<KnowledgeSource[]> {
  const [intelligence, history] = await Promise.all([
    loadPropertyIntelligence(context, propertyId).catch(() => null),
    loadPropertyHistory(context, propertyId).catch(() => null),
  ]);
  const sources: KnowledgeSource[] = [];
  if (history) sources.push({ ...historySource(propertyId, history), label: `${label} · history` });
  if (intelligence) {
    sources.push(...intelligenceSources(propertyId, intelligence));
    sources.push({ id: `property-intel:${propertyId}:location`, label: `${label} · location and data coverage`, href: `properties/${propertyId}`, data: { location: intelligence.location, intelligenceEnabled: intelligence.enabled, latestRun: intelligence.latestRun, enabledSources: intelligence.sources.filter((source) => source.enabled && source.coversProperty).map((source) => source.name), coverage: intelligence.categories.length ? "Latest stored intelligence results." : "No intelligence has been retrieved for this property yet. A refresh can be requested from the property page." } });
  }
  return sources;
}

/** Upcoming visits with forecast weather risk; never invents a forecast. */
async function forecastSources(context: KnowledgeContext, jobIds: string[], now = new Date()): Promise<KnowledgeSource[]> {
  if (!jobIds.length) return [];
  const visits = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ id: appointments.id, jobId: appointments.jobId, startsAt: appointments.startsAt, status: appointments.status, reference: jobs.reference, service: jobs.serviceName, latitude: properties.latitude, longitude: properties.longitude, line1: properties.line1 })
    .from(appointments).innerJoin(jobs, and(eq(jobs.id, appointments.jobId), eq(jobs.organisationId, appointments.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, jobs.organisationId)))
    .where(and(eq(appointments.organisationId, context.organisationId), inArray(appointments.jobId, jobIds), ne(appointments.status, "cancelled"), gte(appointments.startsAt, new Date(now.getTime() - 12 * 3_600_000)), assignedJobScope(context), context.role === "surveyor" ? eq(appointments.surveyorId, context.internalUserId!) : undefined))
    .orderBy(asc(appointments.startsAt)).limit(8));
  const sources: KnowledgeSource[] = [];
  for (const visit of visits) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(visit.startsAt);
    const point = visit.latitude !== null && visit.longitude !== null ? { latitude: visit.latitude, longitude: visit.longitude } : null;
    const forecast: VisitForecast = await visitForecast(context.organisationId, point, date);
    sources.push({
      id: `forecast:${visit.id}`, label: `${visit.reference} · weather outlook for ${date}`, href: `jobs/${visit.jobId}`,
      data: forecast.status === "available"
        ? { visit: { date, startsAt: visit.startsAt.toISOString(), service: visit.service, address: visit.line1 }, forecast: forecast.forecast, assessment: visitWeatherAssessment(visit.service, forecast.forecast), source: forecast.source, retrievedAt: forecast.retrievedAt, evaluationOnly: forecast.evaluationOnly, caveat: "A forecast, not a certainty. Planning prompts only; the surveyor decides whether to proceed, adapt or rearrange." }
        : { visit: { date, service: visit.service, address: visit.line1 }, forecastStatus: forecast.status, message: forecast.message },
    });
  }
  return sources;
}

/** Approved practice wording relevant to the form's elements. */
async function wordingSource(context: KnowledgeContext, elementKeys: Set<string> | null): Promise<KnowledgeSource[]> {
  const clauses = await withTenant(createDatabase(), context.organisationId, (tx) => approvedClauses(tx, context.organisationId));
  const relevant = clauses.filter((clause) => !elementKeys || !clause.elementKey || elementKeys.has(clause.elementKey)).slice(0, 15);
  return relevant.map((clause) => ({ id: `wording:${clause.id}`, label: `Practice wording · ${clause.title}`, href: "reports?view=wording", data: { title: clause.title, purpose: clause.purpose, element: clause.elementKey, conditionRatings: clause.conditionRatings, jurisdictions: clause.jurisdictions, text: clip(clause.body, 700), status: "approved by the practice" } }));
}

/** Properties in the user's permitted work that match a postcode or address in the question. */
async function matchingProperties(context: KnowledgeContext, message: string) {
  const postcode = postcodePattern.exec(message);
  const words = message.replace(postcodePattern, " ").match(/\b\d+[a-z]?\s+[a-z][a-z' -]{2,40}\b/i)?.[0]?.trim();
  if (!postcode && !words) return [];
  return withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ id: properties.id, line1: properties.line1, city: properties.city, postcode: properties.postcode }).from(properties)
    .where(and(eq(properties.organisationId, context.organisationId), assignedPropertyScope(context), or(postcode ? ilike(properties.postcode, `${postcode[1]}%${postcode[2]}`) : undefined, words ? ilike(properties.line1, `%${words}%`) : undefined)))
    .orderBy(desc(properties.updatedAt)).limit(3));
}

/**
 * Knowledge for one SurvAI request. Page context decides what is relevant; the
 * question can add a property search. Every lookup uses the user's own scope.
 */
export async function knowledgeSources(context: KnowledgeContext, input: { message: string; jobId?: string; page?: SurvaiPageContext; scopedJobIds: string[] }): Promise<KnowledgeSource[]> {
  const sources: KnowledgeSource[] = [generalKnowledgeSource];
  const page = input.page?.page;
  const db = createDatabase();
  const jobId = input.jobId ?? (page === "job" || page === "survey" ? input.page?.resourceId : undefined);
  let propertyId = page === "property" ? input.page?.resourceId : undefined;
  let elementKeys: Set<string> | null = null;
  if (jobId && uuid.test(jobId)) {
    const found = await withTenant(db, context.organisationId, async (tx) => {
      const [job] = await tx.select({ propertyId: jobs.propertyId, reference: jobs.reference }).from(jobs).where(and(eq(jobs.organisationId, context.organisationId), eq(jobs.id, jobId), assignedJobScope(context))).limit(1);
      if (!job) return null;
      const [survey] = await tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.organisationId, context.organisationId), eq(surveys.jobId, jobId), ne(surveys.status, "withdrawn"))).orderBy(desc(surveys.createdAt)).limit(1);
      const pack = survey ? await readSurveyPack(tx, context, survey.id) : null;
      return { job, pack };
    });
    if (found) {
      propertyId ??= found.job.propertyId;
      if (found.pack) { sources.push(formStateSource(found.pack)); elementKeys = new Set(found.pack.template.sections.flatMap((section) => section.elements.map((element) => element.key))); }
      sources.push(...await forecastSources(context, [jobId]));
    }
  }
  if (propertyId && uuid.test(propertyId)) {
    const [property] = await withTenant(db, context.organisationId, (tx) => tx.select({ id: properties.id, line1: properties.line1 }).from(properties).where(and(eq(properties.organisationId, context.organisationId), eq(properties.id, propertyId!), assignedPropertyScope(context))).limit(1));
    if (property) sources.push(...await propertyContext(context, property.id, property.line1));
  }
  if (page && ["overview", "calendar", "availability", "routes", "fieldwork", "jobs"].includes(page) && !jobId) sources.push(...await forecastSources(context, input.scopedJobIds));
  if (page === "survey" || page === "reports" || page === "job") sources.push(...await wordingSource(context, elementKeys));
  // A question naming a postcode or street address: search the user's permitted properties first.
  if (!propertyId) {
    const matches = await matchingProperties(context, input.message);
    for (const match of matches) sources.push({ id: `property-match:${match.id}`, label: `${match.line1}, ${match.postcode}`, href: `properties/${match.id}`, data: { property: match, coverage: "Matched from the question within your permitted properties." } }, ...await propertyContext(context, match.id, match.line1));
    const postcode = postcodePattern.exec(input.message);
    if (!matches.length && postcode) {
      // Not in the practice's records: an online public lookup of the postcode area only.
      const result = await searchAddresses({ ...context, demo: false }, `${postcode[1]} ${postcode[2]}`).catch(() => null);
      if (result) sources.push({ id: `public:postcode:${`${postcode[1]}${postcode[2]}`.toUpperCase()}`, label: `Public postcode lookup · ${postcode[1].toUpperCase()} ${postcode[2].toUpperCase()}`, href: "properties", data: { status: result.status, message: result.message, candidates: result.candidates.slice(0, 3).map((candidate) => ({ label: candidate.label, city: candidate.city, postcode: candidate.postcode, country: candidate.country, latitude: candidate.latitude, longitude: candidate.longitude })), attribution: result.attribution, caveat: "Postcode-area public data, not a property record. Add the property to run full intelligence and history." } });
    }
  }
  return sources;
}

/**
 * Re-authorises knowledge citations without the original question, so saved
 * answers stay visible only while the user can still reach their sources.
 */
export async function authorisedKnowledgeIds(context: KnowledgeContext, ids: string[]): Promise<Set<string>> {
  const permitted = new Set<string>();
  const propertyIds = new Set<string>(), surveyIds = new Set<string>(), appointmentIds = new Set<string>(), clauseIds = new Set<string>();
  for (const id of ids) {
    const [kind, first] = id.split(":");
    if (kind === "general" || kind === "public") permitted.add(id);
    else if ((kind === "property-intel" || kind === "history" || kind === "property-match") && uuid.test(first)) propertyIds.add(first);
    else if (kind === "form" && uuid.test(first)) surveyIds.add(first);
    else if (kind === "forecast" && uuid.test(first)) appointmentIds.add(first);
    else if (kind === "wording" && uuid.test(first)) clauseIds.add(first);
  }
  if (!propertyIds.size && !surveyIds.size && !appointmentIds.size && !clauseIds.size) return permitted;
  const reachable = await withTenant(createDatabase(), context.organisationId, async (tx) => ({
    properties: propertyIds.size ? (await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.organisationId, context.organisationId), inArray(properties.id, [...propertyIds]), assignedPropertyScope(context)))).map((row) => row.id) : [],
    surveys: surveyIds.size ? (await tx.select({ id: surveys.id }).from(surveys).innerJoin(jobs, and(eq(jobs.id, surveys.jobId), eq(jobs.organisationId, surveys.organisationId))).where(and(eq(surveys.organisationId, context.organisationId), inArray(surveys.id, [...surveyIds]), assignedJobScope(context)))).map((row) => row.id) : [],
    appointments: appointmentIds.size ? (await tx.select({ id: appointments.id }).from(appointments).innerJoin(jobs, and(eq(jobs.id, appointments.jobId), eq(jobs.organisationId, appointments.organisationId))).where(and(eq(appointments.organisationId, context.organisationId), inArray(appointments.id, [...appointmentIds]), assignedJobScope(context), context.role === "surveyor" ? eq(appointments.surveyorId, context.internalUserId!) : undefined))).map((row) => row.id) : [],
    clauses: clauseIds.size ? (await tx.select({ id: wordingClauses.id }).from(wordingClauses).where(and(eq(wordingClauses.organisationId, context.organisationId), inArray(wordingClauses.id, [...clauseIds]), eq(wordingClauses.status, "approved")))).map((row) => row.id) : [],
  }));
  for (const id of ids) {
    const [kind, first] = id.split(":");
    if ((["property-intel", "history", "property-match"].includes(kind) && reachable.properties.includes(first)) || (kind === "form" && reachable.surveys.includes(first)) || (kind === "forecast" && reachable.appointments.includes(first)) || (kind === "wording" && reachable.clauses.includes(first))) permitted.add(id);
  }
  return permitted;
}
