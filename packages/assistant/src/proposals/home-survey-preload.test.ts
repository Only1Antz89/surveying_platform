import { describe, expect, it } from "vitest";
import { homeSurveyTemplates } from "../forms/home-survey-v1";
import { homeSurveyTemplatesV1_1 } from "../forms/home-survey-v1_1";
import { parseTemplate, resolveField } from "../forms/validate";
import { ruleSetForTemplate } from "../rules/engine";
import { generateSourcedProposals, type CurrentValue, type SnapshotEvidence } from "./sourced";

const template = homeSurveyTemplatesV1_1[1];
const job = { id: "job", reference: "SV-1", targetDate: "2026-10-01" };
const epc: SnapshotEvidence = { snapshotId: "epc", sourceKey: "epc_england_wales", category: "energy_certificate", status: "matched", sourceRecordId: "lmk", retrievedAt: "2026-10-02", sourceUpdatedAt: "2024-04-01", data: { latest: true, propertyType: "House", builtForm: "Semi-detached", constructionAgeBand: "England and Wales: 1900-1929", extensionPermissionDate: "2018-06-01" } };
const dateValue: CurrentValue = { id: "actual-date", value: { state: "provided", value: "2026-09-28" } };
const weather = { contextId: "actual-date|location", inspectionDate: "2026-09-28", summary: "Historical modelled daily context; confirm conditions at the visit.", attribution: "Open-Meteo", retrievedAt: "2026-10-02", url: "https://open-meteo.com/en/docs/historical-weather-api" };

describe("reviewable Home Survey preloaded answers", () => {
  it("versions source metadata without altering wording, order, ratings or old pinned forms", () => {
    homeSurveyTemplatesV1_1.forEach((current, index) => {
      expect(parseTemplate(current).success).toBe(true);
      expect(ruleSetForTemplate(current.key, current.version)).not.toBeNull();
      expect(current.conditionRatingLabels).toEqual(homeSurveyTemplates[index].conditionRatingLabels);
      expect(current.sections.map(s => [s.key, s.label, s.elements.map(e => [e.key, e.fields.map(f => [f.key, f.label, f.type, f.fieldClass])])])).toEqual(homeSurveyTemplates[index].sections.map(s => [s.key, s.label, s.elements.map(e => [e.key, e.fields.map(f => [f.key, f.label, f.type, f.fieldClass])])]));
    });
    expect(resolveField(homeSurveyTemplates[1], "c.details.built_year")?.field.proposalSources).toBeUndefined();
  });
  it("copies EPC age bands without inventing an exact build year or alteration completion dates", async () => {
    const result = await generateSourcedProposals({ template, snapshots: [epc], job, currentValues: new Map() });
    expect(result.proposals.map(p => p.fieldPath)).toEqual(["c.details.property_type", "c.details.built_year"]);
    expect(result.proposals[0].proposedValue).toEqual({ state: "provided", value: "Semi-detached House" });
    expect(result.proposals[1].proposedValue).toEqual({ state: "provided", value: "England and Wales: 1900-1929" });
    expect(result.proposals[1].evidenceRefs[0].id).toBe("epc");
  });
  it("does not overwrite existing answers", async () => {
    const result = await generateSourcedProposals({ template, snapshots: [epc], job, currentValues: new Map([["c.details.built_year", { id: "manual", value: { state: "provided", value: "1890" } }]]) });
    expect(result.proposals.some(p => p.fieldPath === "c.details.built_year")).toBe(false);
    expect(result.discrepancies[0].fieldPath).toBe("c.details.built_year");
  });
  it("uses only the saved actual inspection date, never the scheduled date", async () => {
    const input = { template, snapshots: [], job, weather };
    expect((await generateSourcedProposals({ ...input, currentValues: new Map() })).proposals).toHaveLength(0);
    expect((await generateSourcedProposals({ ...input, currentValues: new Map([["a.details.inspection_date", dateValue]]) })).proposals[0]).toMatchObject({ fieldPath: "a.details.weather", evidenceRefs: [{ type: "weather_record", id: weather.contextId }] });
    expect((await generateSourcedProposals({ ...input, weather: { ...weather, inspectionDate: job.targetDate }, currentValues: new Map([["a.details.inspection_date", dateValue]]) })).proposals).toHaveLength(0);
  });
  it("retains planning-only flood caveats and never equates absence with safety", async () => {
    const flood = { ...epc, snapshotId: "flood", sourceKey: "ea_flood_zones", category: "planning_flood_zone_3", coverage: "covered", confidence: "low", matchMethod: "point_in_polygon", data: {} };
    const result = await generateSourcedProposals({ template, job, currentValues: new Map(), snapshots: [flood] });
    expect(result.proposals[0].fieldPath).toBe("c.details.local_environment");
    expect(String(result.proposals[0].proposedValue.state === "provided" && result.proposals[0].proposedValue.value)).toContain("not a property-specific flood-risk assessment");
    expect(result.proposals[0].limitations.join(" ")).toContain("confidence low");
    expect((await generateSourcedProposals({ template, job, currentValues: new Map(), snapshots: [{ ...flood, status: "no_match" }] })).proposals).toHaveLength(0);
  });
  it("keeps old versions compatible and refuses unapproved sources", async () => {
    expect((await generateSourcedProposals({ template: homeSurveyTemplates[1], job, snapshots: [epc], currentValues: new Map() })).proposals).toHaveLength(0);
    expect((await generateSourcedProposals({ template, job, snapshots: [{ ...epc, sourceKey: "unapproved" }], currentValues: new Map() })).proposals).toHaveLength(0);
  });
});
