import { describe, expect, it } from "vitest";
import { fieldPolicy, getBuiltInTemplate, isFieldRequired, listFields, parseTemplate, resolveField, templateFingerprint, validateFieldValue } from "./validate";
import { residentialTemplateV1 } from "./residential-v1";

const field = (path: string) => {
  const resolved = resolveField(residentialTemplateV1, path);
  if (!resolved) throw new Error(`Missing ${path}`);
  return resolved.field;
};

describe("residential template v1", () => {
  it("passes its own schema", () => {
    const parsed = parseTemplate(residentialTemplateV1);
    expect(parsed.success).toBe(true);
  });

  it("is pinned so published content cannot change silently", async () => {
    // Changing the template requires a new version, never an edit to 1.0.0.
    expect(await templateFingerprint(residentialTemplateV1)).toBe("9d5a4d78b06ecb0e385ce58e8619b5c048808d4a26e97c5bd2b537cdd703dce1");
  });

  it("keeps condition ratings as professional assessments", () => {
    for (const { field: definition } of listFields(residentialTemplateV1)) {
      if (definition.type === "condition_rating") expect(definition.fieldClass).toBe("professional_assessment");
    }
  });

  it("never offers a plain yes/no for external designation records", () => {
    const listed = field("about.property.listed_status");
    expect(listed.options?.map((option) => option.value)).toEqual(["listed", "no_record_found", "not_checked"]);
  });

  it("resolves only well-formed paths", () => {
    expect(resolveField(residentialTemplateV1, "outside.roof_coverings.condition_rating")?.field.type).toBe("condition_rating");
    expect(resolveField(residentialTemplateV1, "outside.roof_coverings")).toBeNull();
    expect(resolveField(residentialTemplateV1, "outside.roof_coverings.__proto__")).toBeNull();
    expect(getBuiltInTemplate("surveynt-residential", "9.9.9")).toBeNull();
  });
});

describe("field values", () => {
  it("rejects values outside the permitted enum", () => {
    expect(validateFieldValue(field("about.property.property_type"), { state: "provided", value: "castle" }).ok).toBe(false);
    expect(validateFieldValue(field("about.property.property_type"), { state: "provided", value: "flat" }).ok).toBe(true);
  });

  it("accepts only 1, 2, 3 or NI as condition ratings", () => {
    const rating = field("outside.main_walls.condition_rating");
    expect(validateFieldValue(rating, { state: "provided", value: "4" }).ok).toBe(false);
    expect(validateFieldValue(rating, { state: "provided", value: "NI" }).ok).toBe(true);
  });

  it("keeps unknown, inaccessible and not applicable distinct from a value", () => {
    const rating = field("inside.roof_structure.condition_rating");
    expect(validateFieldValue(rating, { state: "inaccessible", reason: "No hatch" })).toEqual({ ok: true, value: { state: "inaccessible", reason: "No hatch" } });
    expect(validateFieldValue(rating, { state: "provided" }).ok).toBe(false);
    expect(validateFieldValue(rating, { state: "maybe" }).ok).toBe(false);
  });

  it("validates calendar dates and numeric bounds", () => {
    expect(validateFieldValue(field("inspection.visit.inspection_date"), { state: "provided", value: "2026-02-30" }).ok).toBe(false);
    expect(validateFieldValue(field("inspection.visit.inspection_date"), { state: "provided", value: "2026-10-01" }).ok).toBe(true);
    expect(validateFieldValue(field("about.property.storeys"), { state: "provided", value: 2.5 }).ok).toBe(false);
    expect(validateFieldValue(field("about.property.storeys"), { state: "provided", value: 0 }).ok).toBe(false);
  });

  it("trims text and rejects blank text", () => {
    expect(validateFieldValue(field("inspection.visit.weather"), { state: "provided", value: "  Dry  " })).toEqual({ ok: true, value: { state: "provided", value: "Dry" } });
    expect(validateFieldValue(field("inspection.visit.weather"), { state: "provided", value: "   " }).ok).toBe(false);
  });
});

describe("requirements and policies", () => {
  it("requires element ratings only for inspected elements in rated scopes", () => {
    const rating = field("outside.chimneys.condition_rating");
    expect(isFieldRequired(rating, { serviceLevel: "level_2", inspectionStatus: "inspected" })).toBe(true);
    expect(isFieldRequired(rating, { serviceLevel: "level_2", inspectionStatus: "inaccessible" })).toBe(false);
    expect(isFieldRequired(rating, { serviceLevel: "bespoke", inspectionStatus: "inspected" })).toBe(false);
  });

  it("never allows auto-application outside clerical fields", () => {
    expect(fieldPolicy("clerical").autoApplyEligible).toBe(true);
    expect(fieldPolicy("factual_sourced")).toEqual({ autoApplyEligible: false, requiresVerification: true, requiresExplicitConfirmation: false });
    expect(fieldPolicy("professional_assessment").requiresExplicitConfirmation).toBe(true);
  });
});
