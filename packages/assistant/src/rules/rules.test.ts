import { describe, expect, it } from "vitest";
import { residentialTemplateV1 } from "../forms/residential-v1";
import { serviceLevels, type FieldDefinition, type FieldValue, type ServiceLevel } from "../forms/types";
import { listFields } from "../forms/validate";
import { checkOverrides, evaluateCompletion, parseRuleSet, ruleSetForTemplate, type CompletionInput } from "./engine";
import { residentialRulesV1 } from "./residential-rules-v1";
import { OTHER_OVERRIDE } from "./types";

// Fixtures: a complete survey per service level, built from the template itself, then broken one way per test.
function sample(field: FieldDefinition): FieldValue {
  switch (field.type) {
    case "enum": return { state: "provided", value: field.options![0].value };
    case "multi_enum": return { state: "provided", value: [field.options![0].value] };
    case "integer": case "decimal": return { state: "provided", value: field.min ?? 1 };
    case "boolean": return { state: "provided", value: false };
    case "date": return { state: "provided", value: "2026-09-28" };
    case "condition_rating": return { state: "provided", value: "1" };
    default: return { state: "provided", value: "Recorded on site." };
  }
}

function complete(serviceLevel: ServiceLevel): CompletionInput {
  const values: Record<string, FieldValue> = {};
  const elements: CompletionInput["elements"] = {};
  for (const resolved of listFields(residentialTemplateV1)) {
    const elementKey = `${resolved.section.key}.${resolved.element.key}`;
    if (resolved.element.inspectable) elements[elementKey] = { inspectionStatus: "inspected", limitationReason: null };
    if (resolved.field.requirement !== "optional") values[resolved.path] = sample(resolved.field);
  }
  // Neutral answers, so that no conditional rule fires in the baseline.
  values["about.property.listed_status"] = { state: "provided", value: "no_record_found" };
  values["about.property.conservation_area"] = { state: "provided", value: "no_record_found" };
  return { template: residentialTemplateV1, ruleSet: residentialRulesV1, serviceLevel, values, elements, observations: [], media: [], tasks: [], pendingProposals: 0 };
}

const failing = (input: CompletionInput) => evaluateCompletion(input).items.filter((item) => item.status === "fail").map((item) => item.id);

describe("completion rules", () => {
  it("validates the built-in rule set and pins it to the template version", () => {
    expect(parseRuleSet(residentialRulesV1).rules.length).toBeGreaterThan(5);
    expect(ruleSetForTemplate("surveynt-residential", "1.0.0")?.version).toBe("1.0.0");
    expect(ruleSetForTemplate("surveynt-residential", "9.0.0")).toBeNull();
    expect(() => parseRuleSet({ ...residentialRulesV1, rules: [...residentialRulesV1.rules, residentialRulesV1.rules[0]] })).toThrow(/Duplicate rule/);
  });

  it.each(serviceLevels)("passes a complete %s survey and keeps a stable full checklist", (level) => {
    const report = evaluateCompletion(complete(level));
    expect(report).toMatchObject({ ready: true, hardGateFailures: 0, advisoryFailures: 0 });
    expect(report.items.length).toBeGreaterThan(30);
    expect(evaluateCompletion(complete(level)).items.map((item) => item.id)).toEqual(report.items.map((item) => item.id));
  });

  it("requires commentary at survey scope but not at condition-report scope", () => {
    const level1 = complete("level_1");
    const level2 = complete("level_2");
    delete level1.values["outside.main_walls.commentary"];
    delete level2.values["outside.main_walls.commentary"];
    expect(failing(level1)).toEqual([]);
    expect(failing(level2)).toEqual(["required:outside.main_walls.commentary"]);
  });

  it("asks for communal areas and tenure for a flat", () => {
    const input = complete("level_2");
    input.values["about.property.property_type"] = { state: "provided", value: "flat" };
    delete input.elements["grounds.communal_areas"];
    const ids = failing(input);
    expect(ids).toContain("rule:FLAT-COMMUNAL:survey");
    const item = evaluateCompletion(input).items.find((entry) => entry.id === "rule:FLAT-COMMUNAL:survey")!;
    expect(item.detail).toMatch(/Communal areas/);
    expect(item.detail).toMatch(/Tenure/);
    input.values["about.property.tenure"] = { state: "unknown", reason: "Vendor not available." };
    input.elements["grounds.communal_areas"] = { inspectionStatus: "inaccessible", limitationReason: "Door locked; no key held by agent." };
    expect(failing(input)).toEqual(["contradiction:grounds.communal_areas"]);
    input.values["grounds.communal_areas.condition_rating"] = { state: "provided", value: "NI" };
    expect(failing(input)).toEqual([]);
  });

  it("asks for approvals when alterations are observed", () => {
    const input = complete("level_3");
    input.values["about.property.extensions_present"] = { state: "provided", value: true };
    expect(failing(input)).toEqual(["rule:EXTENSION-APPROVALS:survey"]);
  });

  it("requires a limitation for an inaccessible roof space and suggests a general limitation", () => {
    const input = complete("level_2");
    input.elements["inside.roof_structure"] = { inspectionStatus: "inaccessible", limitationReason: null };
    const report = evaluateCompletion(input);
    const ids = report.items.filter((item) => item.status === "fail").map((item) => [item.id, item.severity]);
    expect(ids).toEqual(expect.arrayContaining([["rule:LIMITATION-RECORDED:inside.roof_structure", "hard_gate"], ["rule:ROOF-SPACE-GENERAL-LIMITATION:survey", "advisory"]]));
    // Rating 1 on an inaccessible element is a contradiction.
    expect(ids).toContainEqual(["contradiction:inside.roof_structure", "hard_gate"]);
  });

  it("requires commentary for a serious rating at every level, and location, evidence and next action for a defect", () => {
    const input = complete("level_1");
    input.values["outside.roof_coverings.condition_rating"] = { state: "provided", value: "3" };
    delete input.values["outside.roof_coverings.commentary"];
    input.observations = [{ id: "obs-1", elementKey: "outside.roof_coverings", locationLabel: "Rear slope", defect: { nextAction: "" }, evidenceCount: 0 }];
    const report = evaluateCompletion(input);
    expect(report.items.filter((item) => item.status === "fail").map((item) => item.id)).toEqual(["rule:SERIOUS-RATING-COMMENTARY:outside.roof_coverings", "rule:DEFECT-DETAIL:obs-1"]);
    expect(report.items.find((item) => item.id === "rule:DEFECT-DETAIL:obs-1")?.detail).toMatch(/evidence.*next action/);
  });

  it("blocks on open discrepancies, unreviewed AI text and unattached report photos; reminders are advisory", () => {
    const input = complete("level_2");
    input.tasks = [
      { id: "t1", kind: "discrepancy", status: "open", title: "EPC age band differs from your entry" },
      { id: "t2", kind: "review_ai_text", status: "open", title: "Review drafted summary" },
      { id: "t3", kind: "reinspect", status: "open", title: "Earlier survey noted damp" },
      { id: "t4", kind: "discrepancy", status: "resolved", title: "Old" },
    ];
    input.media = [{ id: "m1", kind: "photo", forReport: true, linked: false }, { id: "m2", kind: "photo", forReport: false, linked: false }, { id: "m3", kind: "photo", forReport: true, linked: true }];
    input.pendingProposals = 2;
    const report = evaluateCompletion(input);
    expect(report.items.filter((item) => item.status === "fail").map((item) => `${item.id}:${item.severity}`)).toEqual([
      "discrepancy:t1:hard_gate", "ai_review:t2:hard_gate", "reinspect:t3:advisory", "suggestions:pending:advisory", "report_photo:m1:hard_gate", "report_photo:m2:advisory",
    ]);
    expect(report.ready).toBe(false);
  });

  it("accepts only permitted, explained overrides and never overrides fixed gates", () => {
    const input = complete("level_2");
    input.values["about.property.extensions_present"] = { state: "provided", value: true };
    input.tasks = [{ id: "t2", kind: "review_ai_text", status: "open", title: "Review drafted summary" }];
    const report = evaluateCompletion(input);
    expect(checkOverrides(report, [])).toMatchObject({ ok: false, unresolved: [{ id: "rule:EXTENSION-APPROVALS:survey" }, { id: "ai_review:t2" }] });
    const attempt = checkOverrides(report, [
      { itemId: "rule:EXTENSION-APPROVALS:survey", reason: OTHER_OVERRIDE, note: "short" },
      { itemId: "ai_review:t2", reason: OTHER_OVERRIDE, note: "I have read it carefully already." },
      { itemId: "status:outside.chimneys", reason: OTHER_OVERRIDE, note: "Not failing at all here." },
    ]);
    expect(attempt.ok).toBe(false);
    expect(attempt.invalid.map((item) => item.itemId)).toEqual(["rule:EXTENSION-APPROVALS:survey", "ai_review:t2", "status:outside.chimneys"]);
    input.tasks = [];
    const fine = checkOverrides(evaluateCompletion(input), [{ itemId: "rule:EXTENSION-APPROVALS:survey", reason: "Alterations predate any approval requirement" }]);
    expect(fine).toMatchObject({ ok: true, unresolved: [], invalid: [] });
  });
});
