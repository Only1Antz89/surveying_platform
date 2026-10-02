import { evaluateCompletion, ruleSetForTemplate, type CompletionInput, type CompletionReport, type FieldValue, type InspectionStatus, type ServiceLevel } from "@surveynt/assistant";
import type { SurveyPack } from "./surveys";

/**
 * Builds the rule-engine input from a survey pack. It has no server imports,
 * so the survey workspace can run the same checks offline.
 */
export function completionInputFromPack(pack: SurveyPack): CompletionInput | null {
  const ruleSet = ruleSetForTemplate(pack.template.key, pack.template.version);
  if (!ruleSet) return null;
  const elementKeyById = new Map(pack.elements.map((row) => [row.id, `${row.sectionKey}.${row.elementKey}`]));
  const elements: CompletionInput["elements"] = {};
  // Several rows can exist for one element (one per location); the unlocated row carries the element's status.
  for (const row of [...pack.elements].sort((a, b) => (a.locationLabel ? 1 : 0) - (b.locationLabel ? 1 : 0))) {
    const key = `${row.sectionKey}.${row.elementKey}`;
    const existing = elements[key];
    elements[key] = {
      inspectionStatus: existing?.inspectionStatus ?? (row.inspectionStatus as InspectionStatus | null),
      limitationReason: existing?.limitationReason?.trim() ? existing.limitationReason : row.limitationReason,
    };
  }
  const evidenceFor = (targetType: string, targetId: string) => pack.evidence.filter((link) => link.targetType === targetType && link.targetId === targetId).length;
  const linkedMedia = new Set(pack.evidence.filter((link) => link.evidenceType === "media").map((link) => link.evidenceId));
  return {
    template: pack.template,
    ruleSet,
    serviceLevel: pack.survey.serviceLevel as ServiceLevel,
    values: Object.fromEntries(pack.values.map((row) => [row.fieldPath, row.value as unknown as FieldValue])),
    elements,
    observations: pack.observations.map((row) => {
      const defect = (row.structured as { defect?: { nextAction?: string } } | null)?.defect;
      return { id: row.id, elementKey: row.elementId ? elementKeyById.get(row.elementId) ?? null : null, locationLabel: row.locationLabel, defect: defect ? { nextAction: defect.nextAction ?? "" } : null, evidenceCount: evidenceFor("observation", row.id) };
    }),
    media: pack.media.map((row) => ({ id: row.id, kind: row.kind, forReport: (row.captureContext as { forReport?: unknown } | null)?.forReport === true, linked: linkedMedia.has(row.id) })),
    tasks: pack.tasks.map((row) => ({ id: row.id, kind: row.kind, status: row.status, title: row.title })),
    pendingProposals: pack.proposals.length,
  };
}

export function completionReportFromPack(pack: SurveyPack): CompletionReport | null {
  const input = completionInputFromPack(pack);
  return input ? evaluateCompletion(input) : null;
}
