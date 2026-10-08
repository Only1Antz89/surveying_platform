import { describe, expect, it } from "vitest";
import { homeSurveyTemplates } from "./home-survey-v1";
import { homeSurveyTemplatesV1_1 } from "./home-survey-v1_1";
import { homeSurveyTemplatesV1_2 } from "./home-survey-v1_2";
import { homeSurveyEvidenceInventory } from "./home-survey-evidence";
import { listFields, parseTemplate, resolveField, templateFingerprint } from "./validate";
import { generateSourcedProposals, type SnapshotEvidence } from "../proposals/sourced";
import { ruleSetForTemplate } from "../rules/engine";

const shape = (template: typeof homeSurveyTemplates[number]) => template.sections.map(s => [s.key, s.label, s.elements.map(e => [e.key, e.label, e.fields.map(f => [f.key, f.label, f.type, f.fieldClass, f.requirement])])]);
const snapshot: SnapshotEvidence = { snapshotId: "certificate", sourceKey: "epc_england_wales", category: "energy_certificate", status: "matched", sourceRecordId: "123", retrievedAt: "2026-10-04", sourceUpdatedAt: "2024-01-01", data: { latest: true, walls: "Solid brick, no insulation (assumed)", roof: "Pitched, loft insulation", floor: "Suspended, no insulation (assumed)", windows: "Fully double glazed", heating: "Boiler and radiators", hotWater: "From main system", currentRating: "D", potentialRating: "B", totalFloorAreaM2: 85, completion_date: "2024-01-01" } };
const input = { template: homeSurveyTemplatesV1_2[3], snapshots: [snapshot], currentValues: new Map(), job: { id: "job", reference: "DEMO", targetDate: null } };

describe("whole-form evidence policy", () => {
  it("preserves wording, order, required fields, ratings and old versions", async () => {
    const oldFingerprints = await Promise.all(homeSurveyTemplates.map(templateFingerprint));
    for (const [index, template] of homeSurveyTemplatesV1_2.entries()) {
      expect(parseTemplate(template).success).toBe(true);
      expect(shape(template)).toEqual(shape(homeSurveyTemplates[index]));
      expect(template.conditionRatingLabels).toEqual(homeSurveyTemplates[index].conditionRatingLabels);
      expect(ruleSetForTemplate(template.key, template.version)).not.toBeNull();
      expect(await templateFingerprint(template)).not.toEqual(oldFingerprints[index]);
    }
    expect(await Promise.all(homeSurveyTemplates.map(templateFingerprint))).toEqual(oldFingerprints);
    expect(resolveField(homeSurveyTemplatesV1_1[3], "d.d4.construction")?.field.proposalSources).toBeUndefined();
  });
  it("inventories every question including every building element without unsafe answer mappings", () => {
    for (const template of homeSurveyTemplatesV1_2) {
      const inventory = homeSurveyEvidenceInventory(template);
      expect(inventory).toHaveLength([...listFields(template)].length);
      expect(new Set(inventory.map(item => item.path)).size).toBe(inventory.length);
      for (const item of inventory.filter(item => /\.(condition_rating|commentary|limitations|recommendations|repairs|overall_opinion|signature_date|declaration|qualifications|market_value|reinstatement_cost)$/.test(item.path))) expect(item.mode).toBe("manual_only");
    }
  });
  it("keeps historical assumed descriptions and never infers roof materials, alteration years, defects or safety", async () => {
    const { proposals } = await generateSourcedProposals(input);
    expect(proposals.find(p => p.fieldPath === "d.d4.construction")?.proposedValue).toEqual({ state: "provided", value: "Historical EPC description: Solid brick, no insulation (assumed). Verify during inspection." });
    expect(proposals.find(p => p.fieldPath === "f.f5.construction")).toBeDefined();
    expect(proposals.find(p => p.fieldPath === "energy.details.insulation")).toBeDefined();
    expect(proposals.some(p => /condition_rating|commentary|extended_year|converted_year|d\.d2|e\.e1|main_services|further_energy_advice/.test(p.fieldPath))).toBe(false);
    expect(proposals.find(p => p.fieldPath === "c.details.accommodation")?.proposedValue).toEqual({ state: "provided", value: "Certificate-reported total floor area: 85 m². Not a surveyed measurement or room layout; confirm accommodation during inspection." });
  });
  it("rejects unexpected sources and creates a discrepancy rather than overwriting observations", async () => {
    expect((await generateSourcedProposals({ ...input, snapshots: [{ ...snapshot, sourceKey: "untrusted" }] })).proposals).toHaveLength(0);
    const result = await generateSourcedProposals({ ...input, currentValues: new Map([["d.d4.construction", { id: "observed", value: { state: "provided" as const, value: "Observed stone" } }]]) });
    expect(result.proposals.some(p => p.fieldPath === "d.d4.construction")).toBe(false);
    expect(result.discrepancies.some(p => p.fieldPath === "d.d4.construction")).toBe(true);
  });
});
