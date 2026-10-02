import type { ConditionRating, FieldDefinition, FieldValue, FormTemplate, InspectionStatus, ServiceLevel } from "../forms/types";
import { inspectionStatusLabels, valueStateLabels } from "../forms/types";
import { canonicalJson } from "../forms/validate";
import { nextActionLabels, type NextAction } from "../capture/sync";

// Deterministic report assembly. Only recorded field values, current
// observations and the firm's approved clauses are used. Nothing is
// generated: every block quotes or fills approved wording and lists the
// records it came from. Uninspected elements get limitation text only.

export const COMPOSER = "deterministic-composer-v1";

export const clausePurposes = ["element_narrative", "recommendation", "limitation", "summary", "legal_matter"] as const;
export type ClausePurpose = (typeof clausePurposes)[number];
export const clausePurposeLabels: Record<ClausePurpose, string> = {
  element_narrative: "Element narrative",
  recommendation: "Recommendation",
  limitation: "Limitation",
  summary: "Summary",
  legal_matter: "Matter for legal advisers",
};

export const clausePlaceholders = ["element", "location", "next_action", "rating"] as const;
type Placeholder = (typeof clausePlaceholders)[number];

/** Lists placeholders outside the allowlist; a clause using one cannot be approved. */
export function unknownPlaceholders(body: string) {
  return [...body.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]).filter((name) => !(clausePlaceholders as readonly string[]).includes(name));
}

export type WordingClause = {
  id: string;
  clauseKey: string;
  version: number;
  status: "draft" | "approved" | "retired";
  purpose: ClausePurpose;
  title: string;
  body: string;
  elementKey: string | null;
  conditionRatings: string[];
  nextActions: string[];
  inspectionStatuses: string[];
  jurisdictions: string[];
  serviceLevels: string[];
};

export type TraceRef = { type: "field_value" | "observation" | "clause" | "media" | "element"; id: string; label: string; version?: number };
export type ReportBlock = { id: string; kind: "facts" | "paragraph" | "rating" | "limitation" | "not_inspected" | "observation" | "client_statement" | "clause" | "recommendation" | "photos"; text: string; sources: TraceRef[] };
export type ReportElement = { key: string; title: string; inspectionStatus: InspectionStatus; rating: string | null; blocks: ReportBlock[] };
export type ReportSection = { key: string; title: string; blocks: ReportBlock[]; elements: ReportElement[] };

export type ComposedReport = {
  composer: typeof COMPOSER;
  title: string;
  templateKey: string;
  templateVersion: string;
  serviceLevel: ServiceLevel;
  jurisdiction: string;
  jobReference: string;
  property: { line1: string; city: string | null; postcode: string | null };
  sections: ReportSection[];
  ratingSummary: { rating: string; label: string; elements: { key: string; title: string }[] }[];
  recommendations: ReportBlock[];
  /** Things left out and why (missing statuses, clauses whose placeholders could not be filled). */
  omissions: string[];
};

export type ComposerInput = {
  template: FormTemplate;
  serviceLevel: ServiceLevel;
  jurisdiction: string;
  job: { reference: string };
  property: { line1: string; city: string | null; postcode: string | null };
  values: { id: string; fieldPath: string; value: FieldValue }[];
  elements: { id: string; sectionKey: string; elementKey: string; locationLabel: string; inspectionStatus: InspectionStatus | null; limitationReason: string | null }[];
  observations: { id: string; elementId: string | null; kind: string; text: string; locationLabel: string | null; structured: Record<string, unknown>; version: number }[];
  evidence: { targetType: string; targetId: string; evidenceType: string; evidenceId: string }[];
  media: { id: string; kind: string }[];
  clauses: WordingClause[];
};

export type ComposeTrace = { values: { id: string; fieldPath: string }[]; observations: { id: string; version: number }[]; clauses: { id: string; clauseKey: string; version: number }[]; media: string[] };

function renderValue(field: FieldDefinition, value: FieldValue, template: FormTemplate) {
  if (value.state !== "provided") return `${valueStateLabels[value.state]}${value.reason ? `: ${value.reason}` : ""}`;
  const raw = value.value;
  if (field.type === "boolean") return raw ? "Yes" : "No";
  if (field.type === "condition_rating") return template.conditionRatingLabels[String(raw) as ConditionRating] ?? String(raw);
  if (field.type === "enum") return field.options?.find((option) => option.value === raw)?.label ?? String(raw);
  if (field.type === "multi_enum" && Array.isArray(raw)) return raw.map((item) => field.options?.find((option) => option.value === item)?.label ?? item).join(", ");
  if (field.type === "date" && typeof raw === "string") return new Date(`${raw}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${raw}${field.unit ? ` ${field.unit}` : ""}`;
}

type ClauseContext = { purpose: ClausePurpose; elementKey: string | null; rating: string | null; nextActions: string[]; inspectionStatus: InspectionStatus | null; fill: Partial<Record<Placeholder, string>> };

/**
 * Renders a deterministic report from approved material only, with a trace of
 * every record used. The same inputs always give the same output.
 */
export function composeReport(input: ComposerInput): { report: ComposedReport; trace: ComposeTrace } {
  const { template } = input;
  const used = { values: new Map<string, string>(), observations: new Map<string, number>(), clauses: new Map<string, WordingClause>(), media: new Set<string>() };
  const omissions: string[] = [];
  const valueByPath = new Map(input.values.map((row) => [row.fieldPath, row]));
  const approved = input.clauses.filter((clause) => clause.status === "approved").sort((a, b) => a.clauseKey.localeCompare(b.clauseKey));
  let counter = 0;
  const blockId = (prefix: string) => `${prefix}-${(counter += 1).toString().padStart(4, "0")}`;

  const valueRef = (path: string, label: string): TraceRef | null => {
    const row = valueByPath.get(path);
    if (!row) return null;
    used.values.set(row.id, path);
    return { type: "field_value", id: row.id, label };
  };

  const matches = (clause: WordingClause, context: ClauseContext) => clause.purpose === context.purpose
    && (clause.elementKey === null || clause.elementKey === context.elementKey)
    && (!clause.conditionRatings.length || (context.rating !== null && clause.conditionRatings.includes(context.rating)))
    && (!clause.nextActions.length || clause.nextActions.some((action) => context.nextActions.includes(action)))
    && (!clause.inspectionStatuses.length || (context.inspectionStatus !== null && clause.inspectionStatuses.includes(context.inspectionStatus)))
    && (!clause.jurisdictions.length || clause.jurisdictions.includes(input.jurisdiction))
    && (!clause.serviceLevels.length || clause.serviceLevels.includes(input.serviceLevel));

  const applyClause = (clause: WordingClause, context: ClauseContext): ReportBlock[] => {
    const needed = [...clause.body.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1] as Placeholder);
    const missing = needed.filter((name) => !context.fill[name]);
    if (missing.length || unknownPlaceholders(clause.body).length) {
      omissions.push(`Clause "${clause.title}" (${clause.clauseKey} v${clause.version}) was not used${context.elementKey ? ` for ${context.elementKey}` : ""}: nothing to fill {${missing.join("}, {")}}.`);
      return [];
    }
    used.clauses.set(clause.id, clause);
    const text = clause.body.replace(/\{([a-z_]+)\}/g, (_, name: Placeholder) => context.fill[name] ?? "");
    return [{ id: blockId("clause"), kind: context.purpose === "recommendation" ? "recommendation" : "clause", text, sources: [{ type: "clause", id: clause.id, label: `${clause.title} (v${clause.version})`, version: clause.version }] }];
  };

  const clauseBlocks = (context: ClauseContext): ReportBlock[] => approved.filter((clause) => matches(clause, context)).flatMap((clause) => applyClause(clause, context));

  const recommendations: ReportBlock[] = [];
  const ratingGroups = new Map<string, { key: string; title: string }[]>();

  const sections: ReportSection[] = template.sections.map((section) => {
    const sectionBlocks: ReportBlock[] = [];
    const elements: ReportElement[] = [];
    for (const element of section.elements) {
      const elementKey = `${section.key}.${element.key}`;
      if (!element.inspectable) {
        // Context sections: recorded facts, then long-form professional text verbatim.
        const facts = element.fields.filter((field) => field.reportUse === "report" && field.type !== "long_text").flatMap((field) => {
          const row = valueByPath.get(`${elementKey}.${field.key}`);
          return row ? [{ label: field.label, text: renderValue(field, row.value, template), ref: valueRef(row.fieldPath, field.label)! }] : [];
        });
        if (facts.length) sectionBlocks.push({ id: blockId("facts"), kind: "facts", text: facts.map((fact) => `${fact.label}: ${fact.text}`).join("\n"), sources: facts.map((fact) => fact.ref) });
        for (const field of element.fields.filter((item) => item.reportUse === "report" && item.type === "long_text")) {
          const row = valueByPath.get(`${elementKey}.${field.key}`);
          if (!row || row.value.state !== "provided" || !String(row.value.value).trim()) continue;
          sectionBlocks.push({ id: blockId("text"), kind: "paragraph", text: `${field.label}: ${String(row.value.value).trim()}`, sources: [valueRef(row.fieldPath, field.label)!] });
        }
        if (section.key === "matters") sectionBlocks.push(...clauseBlocks({ purpose: "legal_matter", elementKey, rating: null, nextActions: [], inspectionStatus: null, fill: {} }));
        continue;
      }
      const rows = input.elements.filter((row) => row.sectionKey === section.key && row.elementKey === element.key);
      const main = rows.find((row) => !row.locationLabel) ?? rows[0];
      const status = main?.inspectionStatus ?? null;
      if (!status) { omissions.push(`${element.label}: no inspection status recorded, so it is not in the report.`); continue; }
      if (status === "not_applicable") continue;
      const blocks: ReportBlock[] = [];
      const elementSource: TraceRef = { type: "element", id: main.id, label: `${element.label}: ${inspectionStatusLabels[status]}` };
      const limitationText = [main.limitationReason?.trim(), (() => { const row = valueByPath.get(`${elementKey}.limitations`); return row?.value.state === "provided" ? String(row.value.value).trim() : null; })()].filter(Boolean).join(" ");
      const limitationSources = [elementSource, valueRef(`${elementKey}.limitations`, "Inspection limitations")].filter((ref): ref is TraceRef => Boolean(ref));
      if (status === "not_inspected" || status === "inaccessible") {
        blocks.push({ id: blockId("ni"), kind: "not_inspected", text: `${inspectionStatusLabels[status]}.${limitationText ? ` ${limitationText}` : ""}`, sources: limitationSources });
        blocks.push(...clauseBlocks({ purpose: "limitation", elementKey, rating: null, nextActions: [], inspectionStatus: status, fill: { element: element.label.toLowerCase() } }));
        elements.push({ key: elementKey, title: element.label, inspectionStatus: status, rating: null, blocks });
        ratingGroups.set("NI", [...(ratingGroups.get("NI") ?? []), { key: elementKey, title: element.label }]);
        continue;
      }
      const ratingRow = valueByPath.get(`${elementKey}.condition_rating`);
      const rating = ratingRow?.value.state === "provided" ? String(ratingRow.value.value) : null;
      if (rating) {
        blocks.push({ id: blockId("rating"), kind: "rating", text: `Condition rating: ${template.conditionRatingLabels[rating as ConditionRating] ?? rating}`, sources: [valueRef(`${elementKey}.condition_rating`, "Condition rating")!] });
        ratingGroups.set(rating, [...(ratingGroups.get(rating) ?? []), { key: elementKey, title: element.label }]);
      }
      if (status === "partially_inspected") blocks.push({ id: blockId("lim"), kind: "limitation", text: `Partly inspected.${limitationText ? ` ${limitationText}` : ""}`, sources: limitationSources });
      for (const field of element.fields.filter((item) => item.reportUse === "report" && !["condition_rating", "limitations"].includes(item.key))) {
        const row = valueByPath.get(`${elementKey}.${field.key}`);
        if (!row || row.value.state !== "provided" || !String(row.value.value).trim()) continue;
        blocks.push({ id: blockId("text"), kind: "paragraph", text: field.type === "long_text" ? String(row.value.value).trim() : `${field.label}: ${renderValue(field, row.value, template)}`, sources: [valueRef(row.fieldPath, field.label)!] });
      }
      const rowIds = new Set(rows.map((row) => row.id));
      const elementObservations = input.observations.filter((observation) => observation.elementId && rowIds.has(observation.elementId));
      const nextActions: string[] = [];
      for (const observation of elementObservations) {
        used.observations.set(observation.id, observation.version);
        const mediaIds = input.evidence.filter((link) => link.targetType === "observation" && link.targetId === observation.id && link.evidenceType === "media").map((link) => link.evidenceId);
        mediaIds.forEach((id) => used.media.add(id));
        const sources: TraceRef[] = [{ type: "observation", id: observation.id, label: observation.text.slice(0, 80), version: observation.version }, ...mediaIds.map((id) => ({ type: "media" as const, id, label: "Photo" }))];
        const where = observation.locationLabel ? ` (${observation.locationLabel})` : "";
        if (observation.kind === "client_claim") {
          blocks.push({ id: blockId("claim"), kind: "client_statement", text: `The client reported${where}: “${observation.text.trim()}” This was not verified during the inspection.`, sources });
          continue;
        }
        if (observation.kind !== "current_observation" && observation.kind !== "measurement") continue;
        const measurement = (observation.structured.measurement ?? null) as { value: number; unit: string } | null;
        blocks.push({ id: blockId("obs"), kind: "observation", text: `Observed${where}: ${observation.text.trim()}${measurement ? ` (${measurement.value} ${measurement.unit})` : ""}`, sources });
        const defect = observation.structured.defect as { nextAction?: string } | undefined;
        if (defect?.nextAction) {
          nextActions.push(defect.nextAction);
          const label = nextActionLabels[defect.nextAction as NextAction] ?? defect.nextAction;
          recommendations.push({ id: blockId("rec"), kind: "recommendation", text: `${element.label}${where}: ${label}.`, sources });
          recommendations.push(...clauseBlocks({ purpose: "recommendation", elementKey, rating, nextActions: [defect.nextAction], inspectionStatus: status, fill: { element: element.label.toLowerCase(), location: observation.locationLabel ?? element.label.toLowerCase(), next_action: label.toLowerCase(), ...(rating ? { rating } : {}) } }));
        }
      }
      blocks.push(...clauseBlocks({ purpose: "element_narrative", elementKey, rating, nextActions, inspectionStatus: status, fill: { element: element.label.toLowerCase(), ...(rating ? { rating } : {}) } }));
      const elementMedia = input.evidence.filter((link) => link.targetType === "element" && rowIds.has(link.targetId) && link.evidenceType === "media").map((link) => link.evidenceId).filter((id) => input.media.some((media) => media.id === id && media.kind === "photo"));
      if (elementMedia.length) {
        elementMedia.forEach((id) => used.media.add(id));
        blocks.push({ id: blockId("photos"), kind: "photos", text: `${elementMedia.length} photo${elementMedia.length === 1 ? "" : "s"}`, sources: elementMedia.map((id) => ({ type: "media" as const, id, label: "Photo" })) });
      }
      elements.push({ key: elementKey, title: element.label, inspectionStatus: status, rating, blocks });
    }
    return { key: section.key, title: section.label, blocks: sectionBlocks, elements };
  });

  // Summary clauses either always apply, or apply when an element has one of their ratings (the most serious is used).
  const presentRatings = ["3", "2", "1"].filter((rating) => ratingGroups.get(rating)?.length);
  const summaryBlocks = approved.filter((clause) => clause.purpose === "summary").flatMap((clause) => {
    const rating = clause.conditionRatings.length ? presentRatings.find((item) => clause.conditionRatings.includes(item)) ?? null : null;
    const context: ClauseContext = { purpose: "summary", elementKey: null, rating, nextActions: [], inspectionStatus: null, fill: rating ? { rating } : {} };
    return matches(clause, context) ? applyClause(clause, context) : [];
  });
  const summary = sections.find((section) => section.key === "summary");
  if (summary) summary.blocks.push(...summaryBlocks);

  const report: ComposedReport = {
    composer: COMPOSER,
    title: template.title,
    templateKey: template.key,
    templateVersion: template.version,
    serviceLevel: input.serviceLevel,
    jurisdiction: input.jurisdiction,
    jobReference: input.job.reference,
    property: input.property,
    sections,
    ratingSummary: ["3", "2", "1", "NI"].filter((rating) => ratingGroups.get(rating)?.length).map((rating) => ({ rating, label: template.conditionRatingLabels[rating as ConditionRating] ?? rating, elements: ratingGroups.get(rating)! })),
    recommendations,
    omissions,
  };
  return {
    report,
    trace: {
      values: [...used.values].map(([id, fieldPath]) => ({ id, fieldPath })).sort((a, b) => a.fieldPath.localeCompare(b.fieldPath)),
      observations: [...used.observations].map(([id, version]) => ({ id, version })).sort((a, b) => a.id.localeCompare(b.id)),
      clauses: [...used.clauses.values()].map((clause) => ({ id: clause.id, clauseKey: clause.clauseKey, version: clause.version })).sort((a, b) => a.clauseKey.localeCompare(b.clauseKey)),
      media: [...used.media].sort(),
    },
  };
}

/** Fingerprint of every composer input. If it changes after a version is composed, that version is out of date. */
export async function composerInputFingerprint(input: ComposerInput) {
  const material = {
    template: [input.template.key, input.template.version], serviceLevel: input.serviceLevel, jurisdiction: input.jurisdiction,
    values: input.values.map((row) => [row.id, row.fieldPath, row.value]).sort(),
    elements: input.elements.map((row) => [row.id, row.inspectionStatus, row.limitationReason, row.locationLabel]).sort(),
    observations: input.observations.map((row) => [row.id, row.version, row.kind, row.text, row.structured]).sort(),
    evidence: input.evidence.map((row) => [row.targetType, row.targetId, row.evidenceType, row.evidenceId]).sort(),
    clauses: input.clauses.filter((clause) => clause.status === "approved").map((clause) => [clause.id, clause.version]).sort(),
  };
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(material)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The exact statement a surveyor confirms when signing off a report version. */
export const REPORT_SIGN_OFF_STATEMENT = "I have reviewed this report version in full, including its sources and limitations, and approve it for issue.";
