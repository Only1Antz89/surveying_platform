// Pipeline step 2. A candidate is the minimum needed to describe one building
// element: never a whole survey, client details or the property's address.

export type ExtractionSource = {
  survey: { jurisdiction: string | null; serviceLevel: string; templateKey: string; templateVersion: string | number };
  values: { fieldPath: string; value: unknown }[];
  elements: { id: string; sectionKey: string; elementKey: string; locationLabel: string; inspectionStatus: string | null; limitationReason: string | null }[];
  observations: { elementId: string | null; kind: string; text: string; structured: unknown }[];
  /** Photo evidence linked to each element, by element id. Only counted unless photos are granted. */
  photosByElement: Record<string, number>;
  /** Template element labels, keyed "section.element". */
  elementLabels: Record<string, string>;
};

export type CandidateContent = {
  jurisdiction: string;
  serviceLevel: string;
  template: string;
  property: { propertyType: string | null; builtForm: string | null; constructionPeriod: string | null; yearBuilt: number | null; storeys: number | null };
  element: { key: string; label: string; location: string; inspectionStatus: string | null; limitation: string | null; construction: string | null; conditionRating: string | null; commentary: string | null; limitationsText: string | null };
  observations: { kind: string; text: string; nextAction: string | null }[];
  photoCount: number;
};

export type ExtractedCandidate = { elementId: string; elementRef: string; content: CandidateContent };

function provided(values: ExtractionSource["values"], path: string) {
  const entry = values.find((item) => item.fieldPath === path)?.value as { state?: string; value?: unknown } | undefined;
  return entry?.state === "provided" ? entry.value ?? null : null;
}
const asText = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One candidate per inspected or limited element that has a rating or an observation. */
export function extractCandidates(source: ExtractionSource): ExtractedCandidate[] {
  if (!source.survey.jurisdiction) return [];
  const property = {
    propertyType: asText(provided(source.values, "about.property.property_type")),
    builtForm: asText(provided(source.values, "about.property.built_form")),
    constructionPeriod: asText(provided(source.values, "about.property.construction_period")),
    yearBuilt: asNumber(provided(source.values, "about.property.year_built_estimate")),
    storeys: asNumber(provided(source.values, "about.property.storeys")),
  };
  const candidates: ExtractedCandidate[] = [];
  for (const element of source.elements) {
    if (element.inspectionStatus !== "inspected" && element.inspectionStatus !== "partially_inspected" && element.inspectionStatus !== "inaccessible") continue;
    const base = `${element.sectionKey}.${element.elementKey}`;
    const field = (key: string) => provided(source.values, `${base}.${key}`);
    const rating = asText(field("condition_rating"));
    const observations = source.observations.filter((item) => item.elementId === element.id && item.text.trim()).map((item) => {
      const defect = (item.structured as { defect?: { nextAction?: string } } | null)?.defect;
      return { kind: item.kind, text: item.text.trim(), nextAction: defect?.nextAction ?? null };
    });
    if (!rating && observations.length === 0) continue;
    candidates.push({
      elementId: element.id,
      elementRef: base,
      content: {
        jurisdiction: source.survey.jurisdiction,
        serviceLevel: source.survey.serviceLevel,
        template: `${source.survey.templateKey}@${source.survey.templateVersion}`,
        property,
        element: { key: base, label: source.elementLabels[base] ?? element.elementKey, location: element.locationLabel, inspectionStatus: element.inspectionStatus, limitation: element.limitationReason, construction: asText(field("construction")), conditionRating: rating, commentary: asText(field("commentary")), limitationsText: asText(field("limitations")) },
        observations,
        photoCount: source.photosByElement[element.id] ?? 0,
      },
    });
  }
  return candidates;
}
