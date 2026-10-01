import { z } from "zod";
import { ukCountries } from "@surveynt/domain";

/**
 * How a field may be filled. The class decides whether the assistant may
 * prefill, must ask for verification, or must wait for explicit surveyor
 * confirmation. It never relaxes the review rules in the proposal contract.
 */
export const fieldClasses = ["clerical", "factual_sourced", "professional_assessment"] as const;
export type FieldClass = (typeof fieldClasses)[number];

export const fieldClassLabels: Record<FieldClass, string> = {
  clerical: "Clerical: may be prefilled with provenance and undo",
  factual_sourced: "Factual: suggestions need surveyor verification",
  professional_assessment: "Professional assessment: explicit surveyor confirmation only",
};

export const fieldTypes = ["text", "long_text", "enum", "multi_enum", "integer", "decimal", "boolean", "date", "condition_rating"] as const;
export type FieldType = (typeof fieldTypes)[number];

/** Internal, brand-neutral service scopes. Firms map their own service names to these. */
export const serviceLevels = ["level_1", "level_2", "level_3", "bespoke"] as const;
export type ServiceLevel = (typeof serviceLevels)[number];

export const serviceLevelLabels: Record<ServiceLevel, string> = {
  level_1: "Condition report scope",
  level_2: "Survey scope",
  level_3: "Building survey scope",
  bespoke: "Bespoke or defect investigation scope",
};

/**
 * A field either holds a value or records why it does not. Unknown, not
 * inspected, inaccessible and not applicable are distinct professional states
 * and are never collapsed into "No" or an empty string.
 */
export const valueStates = ["provided", "unknown", "not_inspected", "inaccessible", "not_applicable"] as const;
export type ValueState = (typeof valueStates)[number];

export const valueStateLabels: Record<ValueState, string> = {
  provided: "Recorded",
  unknown: "Unknown",
  not_inspected: "Not inspected",
  inaccessible: "Inaccessible",
  not_applicable: "Not applicable",
};

export const inspectionStatuses = ["inspected", "partially_inspected", "not_inspected", "inaccessible", "not_applicable"] as const;
export type InspectionStatus = (typeof inspectionStatuses)[number];

export const inspectionStatusLabels: Record<InspectionStatus, string> = {
  inspected: "Inspected",
  partially_inspected: "Partly inspected",
  not_inspected: "Not inspected",
  inaccessible: "Inaccessible",
  not_applicable: "Not applicable",
};

export const conditionRatings = ["1", "2", "3", "NI"] as const;
export type ConditionRating = (typeof conditionRatings)[number];

const keyPattern = /^[a-z][a-z0-9_]*$/;

export const optionSchema = z.object({
  value: z.string().min(1).max(60).regex(/^[A-Za-z0-9_+]+$/),
  label: z.string().min(1).max(160),
});

export const fieldDefinitionSchema = z.object({
  key: z.string().regex(keyPattern).max(60),
  label: z.string().min(1).max(160),
  type: z.enum(fieldTypes),
  fieldClass: z.enum(fieldClasses),
  options: z.array(optionSchema).min(1).max(60).optional(),
  unit: z.string().max(20).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().positive().max(20000).optional(),
  /** `always` applies to every survey; `when_inspected` only when the element was at least partly inspected. */
  requirement: z.enum(["always", "when_inspected", "optional"]),
  /** Restricts the requirement to these service scopes. Omitted means every scope. */
  requiredForServiceLevels: z.array(z.enum(serviceLevels)).optional(),
  /** `report` fields can appear in the issued report; `internal` stay in the working file. */
  reportUse: z.enum(["report", "internal"]),
  /** Source registry keys allowed to propose a value. Proposals from other origins are rejected. */
  proposalSources: z.array(z.string().max(80)).max(20).optional(),
  guidance: z.string().max(2000).optional(),
}).superRefine((field, context) => {
  if ((field.type === "enum" || field.type === "multi_enum") && !field.options?.length) context.addIssue({ code: "custom", message: `${field.key} needs options` });
  if (field.type !== "enum" && field.type !== "multi_enum" && field.options) context.addIssue({ code: "custom", message: `${field.key} only enum fields may declare options` });
  if (field.type === "condition_rating" && field.fieldClass !== "professional_assessment") context.addIssue({ code: "custom", message: `${field.key} condition ratings are professional assessments` });
});
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

export const elementDefinitionSchema = z.object({
  key: z.string().regex(keyPattern).max(60),
  label: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  /** Building elements record an inspection status; context elements do not. */
  inspectable: z.boolean(),
  fields: z.array(fieldDefinitionSchema).min(1).max(60),
});
export type ElementDefinition = z.infer<typeof elementDefinitionSchema>;

export const sectionDefinitionSchema = z.object({
  key: z.string().regex(keyPattern).max(60),
  label: z.string().min(1).max(160),
  elements: z.array(elementDefinitionSchema).min(1).max(60),
});
export type SectionDefinition = z.infer<typeof sectionDefinitionSchema>;

export const formTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1).max(160),
  /** Template provenance. Surveynt-authored templates contain no third-party standard text. */
  authoredBy: z.string().min(1).max(160),
  contentLicence: z.string().min(1).max(500),
  reviewStatus: z.enum(["draft_requires_surveyor_review", "surveyor_reviewed"]),
  jurisdictions: z.array(z.enum(ukCountries)).min(1),
  serviceLevels: z.array(z.enum(serviceLevels)).min(1),
  conditionRatingLabels: z.record(z.enum(conditionRatings), z.string().min(1).max(200)),
  sections: z.array(sectionDefinitionSchema).min(1).max(40),
}).superRefine((template, context) => {
  const sectionKeys = new Set<string>();
  for (const section of template.sections) {
    if (sectionKeys.has(section.key)) context.addIssue({ code: "custom", message: `Duplicate section ${section.key}` });
    sectionKeys.add(section.key);
    const elementKeys = new Set<string>();
    for (const element of section.elements) {
      if (elementKeys.has(element.key)) context.addIssue({ code: "custom", message: `Duplicate element ${section.key}.${element.key}` });
      elementKeys.add(element.key);
      const fieldKeys = new Set<string>();
      for (const field of element.fields) {
        if (fieldKeys.has(field.key)) context.addIssue({ code: "custom", message: `Duplicate field ${section.key}.${element.key}.${field.key}` });
        fieldKeys.add(field.key);
      }
    }
  }
});
export type FormTemplate = z.infer<typeof formTemplateSchema>;

/** A stored field value. `value` is present only when `state` is `provided`. */
export type FieldValue =
  | { state: "provided"; value: string | number | boolean | string[] }
  | { state: Exclude<ValueState, "provided">; reason?: string };

export const fieldValueSchema: z.ZodType<FieldValue> = z.discriminatedUnion("state", [
  z.object({ state: z.literal("provided"), value: z.union([z.string().max(20000), z.number().finite(), z.boolean(), z.array(z.string().max(200)).max(60)]) }),
  z.object({ state: z.literal("unknown"), reason: z.string().max(1000).optional() }),
  z.object({ state: z.literal("not_inspected"), reason: z.string().max(1000).optional() }),
  z.object({ state: z.literal("inaccessible"), reason: z.string().max(1000).optional() }),
  z.object({ state: z.literal("not_applicable"), reason: z.string().max(1000).optional() }),
]);
