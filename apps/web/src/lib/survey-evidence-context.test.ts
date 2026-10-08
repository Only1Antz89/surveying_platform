import { describe, expect, it } from "vitest";
import { questionnaireFieldContext, externalFieldContext } from "./survey-evidence-context";
describe("whole-form contextual evidence boundaries", () => {
  it("keeps occupancy/services/legal statements labelled and never maps them to ratings or opinion", () => {
    expect(questionnaireFieldContext("a.details.property_status", { occupancy: "Vacant" })).toEqual(["Customer reports (occupancy): Vacant"]);
    expect(questionnaireFieldContext("f.f2.construction", { services: "Gas boiler" })[0]).toContain("Customer reports");
    expect(questionnaireFieldContext("d.d2.condition_rating", { concerns: "Roof leaking" })).toEqual([]);
    expect(questionnaireFieldContext("b.details.overall_opinion", { concerns: "Roof leaking" })).toEqual([]);
  });
  it("does not turn missing or stale external evidence into a property description", () => {
    expect(externalFieldContext("d.d2.construction", [])).toEqual([]);
    expect(externalFieldContext("i.details.building_risks", [])).toEqual([]);
  });
});
