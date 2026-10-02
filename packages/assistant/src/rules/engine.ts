import type { FieldValue, FormTemplate, InspectionStatus, ServiceLevel } from "../forms/types";
import { isFieldRequired, resolveField } from "../forms/validate";
import { residentialRulesV1 } from "./residential-rules-v1";
import { OTHER_OVERRIDE, ruleSetSchema, type CheckItem, type CompletionOverride, type CompletionReport, type Rule, type RuleCondition, type RuleRequirement, type RuleSet } from "./types";

export type CompletionInput = {
  template: FormTemplate;
  ruleSet: RuleSet;
  serviceLevel: ServiceLevel;
  /** Current value per field path. */
  values: Record<string, FieldValue>;
  /** Inspection status per "section.element". */
  elements: Record<string, { inspectionStatus: InspectionStatus | null; limitationReason: string | null }>;
  observations: { id: string; elementKey: string | null; locationLabel: string | null; defect: { nextAction: string } | null; evidenceCount: number }[];
  media: { id: string; kind: string; forReport: boolean; linked: boolean }[];
  tasks: { id: string; kind: string; status: string; title: string }[];
  pendingProposals: number;
};

export const builtInRuleSets: readonly RuleSet[] = [residentialRulesV1];

/** Newest rule set written for this template version, or null when none applies. */
export function ruleSetForTemplate(templateKey: string, templateVersion: string) {
  return builtInRuleSets.filter((ruleSet) => ruleSet.templateKey === templateKey && ruleSet.templateVersions.includes(templateVersion))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0] ?? null;
}

export function parseRuleSet(definition: unknown) {
  return ruleSetSchema.parse(definition);
}

const hasReason = (value: FieldValue) => value.state !== "provided" && Boolean(value.reason?.trim());
const isProvided = (value: FieldValue | undefined) => value?.state === "provided" && !(typeof value.value === "string" && !value.value.trim()) && !(Array.isArray(value.value) && !value.value.length);
const isAnswered = (value: FieldValue | undefined) => Boolean(value) && (isProvided(value) || (value!.state !== "provided" && value!.state !== "unknown") || hasReason(value!));

type Scope = { element?: string; observation?: CompletionInput["observations"][number] };

function substitute(reference: string, scope: Scope) {
  return scope.element ? reference.replace("$element", scope.element) : reference;
}

function ratingOf(input: CompletionInput, element: string) {
  const value = input.values[`${element}.condition_rating`];
  return value?.state === "provided" ? String(value.value) : null;
}

function matches(condition: RuleCondition, input: CompletionInput, scope: Scope): boolean {
  switch (condition.type) {
    case "always": return true;
    case "field_in": {
      const value = input.values[substitute(condition.path, scope)];
      return value?.state === "provided" && condition.values.some((item) => item === value.value);
    }
    case "element_status_in": {
      const status = input.elements[substitute(condition.element, scope)]?.inspectionStatus;
      return Boolean(status && condition.statuses.includes(status));
    }
    case "rating_in": {
      const rating = ratingOf(input, substitute(condition.element, scope));
      return Boolean(rating && (condition.ratings as string[]).includes(rating));
    }
    case "observation_is_defect": return Boolean(scope.observation?.defect);
    case "all": return condition.conditions.every((item) => matches(item, input, scope));
    case "any": return condition.conditions.some((item) => matches(item, input, scope));
  }
}

function fieldLabel(template: FormTemplate, path: string) {
  const resolved = resolveField(template, path);
  return resolved ? `${resolved.element.label}: ${resolved.field.label}` : path;
}

function elementLabel(template: FormTemplate, element: string) {
  const [sectionKey, elementKey] = element.split(".");
  return template.sections.find((section) => section.key === sectionKey)?.elements.find((item) => item.key === elementKey)?.label ?? element;
}

/** Returns a description of the unmet requirement, or null when it is met. */
function unmet(requirement: RuleRequirement, input: CompletionInput, scope: Scope): string | null {
  switch (requirement.type) {
    case "field_provided": {
      const path = substitute(requirement.path, scope);
      return isProvided(input.values[path]) ? null : `Record ${fieldLabel(input.template, path)}.`;
    }
    case "field_answered": {
      const path = substitute(requirement.path, scope);
      return isAnswered(input.values[path]) ? null : `Answer ${fieldLabel(input.template, path)}, or record why it cannot be answered.`;
    }
    case "element_status_recorded": {
      const element = substitute(requirement.element, scope);
      return input.elements[element]?.inspectionStatus ? null : `Record the inspection status of ${elementLabel(input.template, element)}.`;
    }
    case "limitation_recorded": {
      const element = substitute(requirement.element, scope);
      return input.elements[element]?.limitationReason?.trim() || isProvided(input.values[`${element}.limitations`]) ? null : `Record the inspection limitation for ${elementLabel(input.template, element)}.`;
    }
    case "observation_location": return scope.observation?.locationLabel?.trim() || scope.observation?.elementKey ? null : "Record where the defect is.";
    case "observation_evidence": return (scope.observation?.evidenceCount ?? 0) >= requirement.min ? null : `Attach at least ${requirement.min} item${requirement.min === 1 ? "" : "s"} of evidence, such as a photo.`;
    case "observation_next_action": return scope.observation?.defect?.nextAction ? null : "Record the recommended next action.";
  }
}

function ruleItems(rule: Rule, input: CompletionInput): CheckItem[] {
  if (rule.serviceLevels && !rule.serviceLevels.includes(input.serviceLevel)) return [];
  const scopes: { key: string; scope: Scope; label: string | null; element: string | null }[] = rule.scope === "survey"
    ? [{ key: "survey", scope: {}, label: null, element: null }]
    : rule.scope === "each_element"
      ? input.template.sections.flatMap((section) => section.elements.filter((element) => element.inspectable).map((element) => {
        const key = `${section.key}.${element.key}`;
        return { key, scope: { element: key }, label: element.label, element: key };
      }))
      : input.observations.map((observation) => ({ key: observation.id, scope: { observation, element: observation.elementKey ?? undefined }, label: observation.elementKey ? elementLabel(input.template, observation.elementKey) : "Observation", element: observation.elementKey }));
  return scopes.filter((item) => matches(rule.when, input, item.scope)).map((item) => {
    const problems = rule.require.map((requirement) => unmet(requirement, input, item.scope)).filter((problem): problem is string => Boolean(problem));
    return {
      id: `rule:${rule.id}:${item.key}`, category: "rule", severity: rule.severity, status: problems.length ? "fail" : "pass",
      title: item.label ? `${rule.title} (${item.label})` : rule.title, detail: problems.length ? problems.join(" ") : null,
      ruleId: rule.id, justification: rule.justification, fieldPath: null, elementKey: item.element, overrideReasons: rule.overrideReasons,
    };
  });
}

const base = { ruleId: null, justification: null, fieldPath: null, elementKey: null, overrideReasons: [] as string[] };

/**
 * Deterministic completion checks for one survey: the template's required
 * fields and inspection statuses, contradictions, open discrepancies and AI
 * review tasks, photos, and the versioned rule set. The same function runs
 * offline in the browser and on the server at the stage gate.
 */
export function evaluateCompletion(input: CompletionInput): CompletionReport {
  const items: CheckItem[] = [];
  for (const section of input.template.sections) {
    for (const element of section.elements) {
      const elementKey = `${section.key}.${element.key}`;
      const state = input.elements[elementKey];
      if (element.inspectable) {
        items.push({ ...base, id: `status:${elementKey}`, category: "inspection_status", severity: "hard_gate", status: state?.inspectionStatus ? "pass" : "fail", title: `${element.label}: inspection status`, detail: state?.inspectionStatus ? null : "Record whether this element was inspected, partly inspected, not inspected, inaccessible or not applicable.", elementKey });
        const rating = ratingOf(input, elementKey);
        const status = state?.inspectionStatus ?? null;
        const contradiction = rating && status
          ? rating === "NI" && (status === "inspected" || status === "partially_inspected") ? "The element is marked as inspected but rated NI (not inspected)."
            : rating !== "NI" && (status === "not_inspected" || status === "inaccessible") ? `The element is marked ${status.replace("_", " ")} but has condition rating ${rating}.`
              : status === "not_applicable" ? "The element is marked not applicable but has a condition rating." : null
          : null;
        if (rating && status) items.push({ ...base, id: `contradiction:${elementKey}`, category: "contradiction", severity: "hard_gate", status: contradiction ? "fail" : "pass", title: `${element.label}: status and rating agree`, detail: contradiction, elementKey });
      }
      for (const field of element.fields) {
        if (!isFieldRequired(field, { serviceLevel: input.serviceLevel, inspectionStatus: element.inspectable ? state?.inspectionStatus ?? null : undefined })) continue;
        // An element awaiting its status cannot yet decide its "when inspected" fields; the status item covers it.
        const path = `${elementKey}.${field.key}`;
        const value = input.values[path];
        const ok = isProvided(value) || (value !== undefined && value.state !== "provided" && hasReason(value));
        items.push({ ...base, id: `required:${path}`, category: "required_field", severity: "hard_gate", status: ok ? "pass" : "fail", title: `${element.label}: ${field.label}`, detail: ok ? null : value && value.state !== "provided" ? `Marked ${value.state.replace(/_/g, " ")}: add the reason.` : "Required for this service level.", fieldPath: path, elementKey });
      }
    }
  }
  for (const rule of input.ruleSet.rules) items.push(...ruleItems(rule, input));
  for (const task of input.tasks.filter((item) => item.status === "open")) {
    if (task.kind === "discrepancy") items.push({ ...base, id: `discrepancy:${task.id}`, category: "discrepancy", severity: "hard_gate", status: "fail", title: task.title, detail: "Resolve or dismiss this discrepancy with a note, or record why the report proceeds.", overrideReasons: ["Explained in the report", "Source record confirmed as wrong", OTHER_OVERRIDE] });
    if (task.kind === "review_ai_text") items.push({ ...base, id: `ai_review:${task.id}`, category: "ai_review", severity: "hard_gate", status: "fail", title: task.title, detail: "AI-assisted text must be reviewed by a person before the report can progress. This cannot be overridden." });
    if (task.kind === "reinspect") items.push({ ...base, id: `reinspect:${task.id}`, category: "reinspection", severity: "advisory", status: "fail", title: task.title, detail: "A defect reported in an earlier survey has not been checked off. It is a reminder, not a finding." });
  }
  if (input.pendingProposals > 0) items.push({ ...base, id: "suggestions:pending", category: "suggestions", severity: "advisory", status: "fail", title: `${input.pendingProposals} suggestion${input.pendingProposals === 1 ? "" : "s"} not reviewed`, detail: "Unreviewed suggestions are not part of the report. Accept, edit or reject them if they are relevant." });
  for (const media of input.media.filter((item) => item.kind === "photo")) {
    if (media.linked) continue;
    items.push({ ...base, id: `report_photo:${media.id}`, category: "report_photo", severity: media.forReport ? "hard_gate" : "advisory", status: "fail", title: media.forReport ? "Report photo not attached" : "Photo not attached", detail: "Attach the photo to an element or observation so it can be traced, or mark it as not needed.", overrideReasons: media.forReport ? ["Photo not needed in the report", OTHER_OVERRIDE] : [] });
  }
  const failures = items.filter((item) => item.status === "fail");
  const hardGateFailures = failures.filter((item) => item.severity === "hard_gate").length;
  return {
    ruleSetKey: input.ruleSet.key, ruleSetVersion: input.ruleSet.version, templateKey: input.template.key, templateVersion: input.template.version, serviceLevel: input.serviceLevel,
    items, hardGateFailures, advisoryFailures: failures.length - hardGateFailures, ready: hardGateFailures === 0,
  };
}

export type OverrideCheck = {
  ok: boolean;
  /** Failing hard gates with no valid override. */
  unresolved: CheckItem[];
  /** Overrides that do not match a failing, overridable hard gate or use an unlisted reason. */
  invalid: { itemId: string; message: string }[];
  accepted: (CompletionOverride & { item: CheckItem })[];
};

/** Every failing hard gate needs a permitted reason; "other" needs a note. Items without reasons cannot be overridden. */
export function checkOverrides(report: CompletionReport, overrides: CompletionOverride[]): OverrideCheck {
  const failing = new Map(report.items.filter((item) => item.status === "fail" && item.severity === "hard_gate").map((item) => [item.id, item]));
  const invalid: OverrideCheck["invalid"] = [];
  const accepted: OverrideCheck["accepted"] = [];
  for (const override of overrides) {
    const item = failing.get(override.itemId);
    if (!item) { invalid.push({ itemId: override.itemId, message: "This check is not a failing hard gate." }); continue; }
    if (!item.overrideReasons.length) { invalid.push({ itemId: override.itemId, message: "This check cannot be overridden." }); continue; }
    if (!item.overrideReasons.includes(override.reason)) { invalid.push({ itemId: override.itemId, message: "Choose one of the permitted reasons." }); continue; }
    if (override.reason === OTHER_OVERRIDE && (override.note?.trim().length ?? 0) < 10) { invalid.push({ itemId: override.itemId, message: "Explain the reason in the note (at least 10 characters)." }); continue; }
    accepted.push({ ...override, item });
  }
  const covered = new Set(accepted.map((item) => item.itemId));
  const unresolved = [...failing.values()].filter((item) => !covered.has(item.id));
  return { ok: unresolved.length === 0 && invalid.length === 0, unresolved, invalid, accepted };
}
