import { conditionRatings, fieldValueSchema, formTemplateSchema, type ElementDefinition, type FieldClass, type FieldDefinition, type FieldValue, type FormTemplate, type InspectionStatus, type SectionDefinition, type ServiceLevel } from "./types";
import { residentialTemplateV1 } from "./residential-v1";

export type FieldPath = `${string}.${string}.${string}`;

export function fieldPath(section: string, element: string, field: string): FieldPath {
  return `${section}.${element}.${field}`;
}

export function parseFieldPath(path: string) {
  const parts = path.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[a-z][a-z0-9_]*$/.test(part))) return null;
  return { section: parts[0], element: parts[1], field: parts[2] };
}

export type ResolvedField = { section: SectionDefinition; element: ElementDefinition; field: FieldDefinition; path: FieldPath };

export function resolveField(template: FormTemplate, path: string): ResolvedField | null {
  const parsed = parseFieldPath(path);
  if (!parsed) return null;
  const section = template.sections.find((item) => item.key === parsed.section);
  const element = section?.elements.find((item) => item.key === parsed.element);
  const field = element?.fields.find((item) => item.key === parsed.field);
  return section && element && field ? { section, element, field, path: fieldPath(section.key, element.key, field.key) } : null;
}

export function* listFields(template: FormTemplate): Generator<ResolvedField> {
  for (const section of template.sections) {
    for (const element of section.elements) {
      for (const field of element.fields) yield { section, element, field, path: fieldPath(section.key, element.key, field.key) };
    }
  }
}

export function resolveElement(template: FormTemplate, sectionKey: string, elementKey: string) {
  const section = template.sections.find((item) => item.key === sectionKey);
  const element = section?.elements.find((item) => item.key === elementKey);
  return section && element ? { section, element } : null;
}

export type ValueValidation = { ok: true; value: FieldValue } | { ok: false; message: string };

/** Validates a stored value against the field definition and its permitted values. */
export function validateFieldValue(field: FieldDefinition, input: unknown): ValueValidation {
  const parsed = fieldValueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The value must record a state and, when provided, a value." };
  const value = parsed.data;
  if (value.state !== "provided") return { ok: true, value };
  const raw = value.value;
  switch (field.type) {
    case "text":
    case "long_text":
      if (typeof raw !== "string" || !raw.trim()) return { ok: false, message: `${field.label} must be text.` };
      if (field.maxLength && raw.length > field.maxLength) return { ok: false, message: `${field.label} is limited to ${field.maxLength} characters.` };
      return { ok: true, value: { state: "provided", value: raw.trim() } };
    case "enum":
      if (typeof raw !== "string" || !field.options?.some((option) => option.value === raw)) return { ok: false, message: `${field.label} must be one of the permitted options.` };
      return { ok: true, value };
    case "multi_enum":
      if (!Array.isArray(raw) || !raw.length || raw.some((item) => !field.options?.some((option) => option.value === item)) || new Set(raw).size !== raw.length) return { ok: false, message: `${field.label} must contain permitted, unique options.` };
      return { ok: true, value };
    case "integer":
    case "decimal": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false, message: `${field.label} must be a number.` };
      if (field.type === "integer" && !Number.isInteger(raw)) return { ok: false, message: `${field.label} must be a whole number.` };
      if (field.min !== undefined && raw < field.min) return { ok: false, message: `${field.label} must be at least ${field.min}.` };
      if (field.max !== undefined && raw > field.max) return { ok: false, message: `${field.label} must be at most ${field.max}.` };
      return { ok: true, value };
    }
    case "boolean":
      return typeof raw === "boolean" ? { ok: true, value } : { ok: false, message: `${field.label} must be yes or no.` };
    case "date":
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) return { ok: false, message: `${field.label} must be a valid date.` };
      return { ok: true, value };
    case "condition_rating":
      return typeof raw === "string" && (conditionRatings as readonly string[]).includes(raw) ? { ok: true, value } : { ok: false, message: `${field.label} must be 1, 2, 3 or NI.` };
  }
}

/** Whether completion checks must see a value or an explicit state for this field. */
export function isFieldRequired(field: FieldDefinition, context: { serviceLevel: ServiceLevel; inspectionStatus?: InspectionStatus | null }) {
  if (field.requirement === "optional") return false;
  if (field.requiredForServiceLevels && !field.requiredForServiceLevels.includes(context.serviceLevel)) return false;
  if (field.requirement === "when_inspected") return context.inspectionStatus === "inspected" || context.inspectionStatus === "partially_inspected";
  return true;
}

export type FieldPolicy = {
  /** Only clerical fields may ever be applied without a review decision, and only when the firm enables it. */
  autoApplyEligible: boolean;
  requiresVerification: boolean;
  requiresExplicitConfirmation: boolean;
};

export function fieldPolicy(fieldClass: FieldClass): FieldPolicy {
  if (fieldClass === "clerical") return { autoApplyEligible: true, requiresVerification: false, requiresExplicitConfirmation: false };
  if (fieldClass === "factual_sourced") return { autoApplyEligible: false, requiresVerification: true, requiresExplicitConfirmation: false };
  return { autoApplyEligible: false, requiresVerification: true, requiresExplicitConfirmation: true };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

/** SHA-256 over canonical JSON. Pinning surveys to it detects any silent edit to a published template. */
export async function templateFingerprint(template: FormTemplate) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(template)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseTemplate(definition: unknown) {
  return formTemplateSchema.safeParse(definition);
}

export const builtInTemplates: readonly FormTemplate[] = [residentialTemplateV1];

export function getBuiltInTemplate(key: string, version: string) {
  return builtInTemplates.find((template) => template.key === key && template.version === version) ?? null;
}

export const defaultTemplate = residentialTemplateV1;
