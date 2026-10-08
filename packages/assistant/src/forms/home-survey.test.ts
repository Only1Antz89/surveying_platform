import { describe, expect, it } from "vitest";
import { homeSurveyTemplates } from "./home-survey-v1";
import { getBuiltInTemplate, parseTemplate, resolveField } from "./validate";
import { ruleSetForTemplate, parseRuleSet } from "../rules/engine";

describe("versioned firm Home Survey recorder", () => {
  it.each(homeSurveyTemplates)("registers $key without replacing earlier templates", template => {
    expect(parseTemplate(template).success).toBe(true);
    expect(getBuiltInTemplate(template.key, template.version)).toBe(template);
    expect(getBuiltInTemplate("surveynt-residential", "1.0.0")).not.toBeNull();
    const rules = ruleSetForTemplate(template.key, template.version)!;
    expect(parseRuleSet(rules)).toEqual(rules);
    expect(rules.rules.some(rule => rule.id === "LIMITATION-RECORDED")).toBe(true);
  });
  it("retains the supplied A–I section order and separate service scopes", () => {
    for (const template of homeSurveyTemplates) {
      expect(template.sections.slice(0, 9).map(section => section.key)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
      expect(template.serviceLevels).toHaveLength(1);
      expect(template.reviewStatus).toBe("draft_requires_surveyor_review");
      expect(template.contentLicence).toContain("No RICS brand licence or compliance approval");
    }
    expect(homeSurveyTemplates[2].sections.some(section => section.key === "valuation")).toBe(true);
    expect(homeSurveyTemplates[3].sections.some(section => section.key === "energy")).toBe(true);
  });
  it("retains professional ratings, declaration and inspection fields", () => {
    const template = homeSurveyTemplates[1];
    expect(resolveField(template, "d.d1.condition_rating")?.field.fieldClass).toBe("professional_assessment");
    expect(resolveField(template, "declaration.details.rics_number")?.field.label).toContain("RICS");
    expect(template.conditionRatingLabels).toHaveProperty("NI");
    expect(template.sections.find(section => section.key === "d")?.elements[0].label).toContain("Chimney stacks");
  });
});
