// Historical findings from earlier surveys are reminders to reinspect. They
// are never copied into the current survey as findings.

export type PriorObservation = {
  id: string;
  surveyId: string;
  surveyDate: string | null;
  sectionKey: string | null;
  elementKey: string | null;
  locationLabel: string | null;
  text: string;
  conditionRating: string | null;
};

export type TaskDraft = { kind: "reinspect"; dedupeKey: string; elementKey: string | null; title: string; detail: string; evidence: Record<string, unknown> };

/** Builds one reinspection prompt per prior recorded observation, deduplicated by the prior record id. */
export function reinspectTasksFromHistory(prior: PriorObservation[]): TaskDraft[] {
  return prior.map((observation) => ({
    kind: "reinspect",
    dedupeKey: `reinspect:${observation.id}`,
    elementKey: observation.elementKey,
    title: `Reinspect: ${observation.elementKey ? observation.elementKey.replace(/_/g, " ") : "earlier observation"}${observation.locationLabel ? ` (${observation.locationLabel})` : ""}`,
    detail: `An earlier survey${observation.surveyDate ? ` on ${observation.surveyDate}` : ""} recorded: "${observation.text.slice(0, 300)}${observation.text.length > 300 ? "…" : ""}". This is historical context only. Record what you see now.`,
    evidence: { priorSurveyId: observation.surveyId, priorObservationId: observation.id, priorConditionRating: observation.conditionRating },
  }));
}
