import { homeSurveyTemplatesV1_1 } from "./home-survey-v1_1";
import { evidenceMapping } from "./home-survey-evidence";
import type { FormTemplate } from "./types";

// Registered but not automatically selected: rollout and explicit upgrades are separate operations.
export const homeSurveyTemplatesV1_2: readonly FormTemplate[] = homeSurveyTemplatesV1_1.map(template => ({
  ...template, version: "1.2.0",
  sections: template.sections.map(section => ({ ...section, elements: section.elements.map(element => ({ ...element, fields: element.fields.map(field => {
    const mapping = evidenceMapping(`${section.key}.${element.key}.${field.key}`);
    return mapping ? { ...field, proposalSources: mapping.mode === "suggested_answer" ? mapping.sources : [], guidance: mapping.boundary } : { ...field };
  }) })) })),
}));
