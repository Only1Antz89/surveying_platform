import { homeSurveyTemplates } from "./home-survey-v1";
import type { FormTemplate } from "./types";

// Keep 1.0.0 intact: existing surveys remain pinned to its fingerprint.
const sources: Record<string, string[]> = {
  "a.details.weather": ["inspection_weather"],
  "c.details.property_type": ["epc_england_wales", "scottish_epc"],
  "c.details.built_year": ["epc_england_wales", "scottish_epc"],
  "c.details.local_environment": ["planning_data", "historic_england_nhle", "ea_flood_zones", "ne_designations"],
};
const guidance: Record<string, string> = {
  "a.details.weather": "Save the actual inspection date, then load evidence. Historical weather is day-wide modelled context, not an observation at the property or inspection time. Confirm conditions personally; enter manually if unavailable.",
  "c.details.built_year": "An EPC may record an approximate construction range, not an exact year. Retain the range and verify against the building and documents.",
  "c.details.extended_year": "Enter an evidenced approximate completion year manually. A planning application or permission date does not establish when an extension was built.",
  "c.details.converted_year": "Enter an evidenced approximate completion year manually. Permission to convert does not establish that conversion occurred.",
  "c.details.local_environment": "External designations are indicative context only. Add your inspection observations; missing records do not mean safe or low risk.",
};
export const homeSurveyTemplatesV1_1: readonly FormTemplate[] = homeSurveyTemplates.map(template => ({
  ...template, version: "1.1.0",
  sections: template.sections.map(section => ({ ...section, elements: section.elements.map(element => ({ ...element, fields: element.fields.map(field => {
    const path = `${section.key}.${element.key}.${field.key}`;
    return { ...field, ...(sources[path] ? { proposalSources: sources[path] } : {}), ...(guidance[path] ? { guidance: guidance[path] } : {}) };
  }) })) })),
}));
