import { z } from "zod";
import { conditionRatings, inspectionStatuses, serviceLevels, type ConditionRating, type InspectionStatus, type ServiceLevel } from "../forms/types";

// Declarative, versioned completion rules. Rules only ask for information;
// they never fill fields, choose ratings or write report text.

export const ruleSeverities = ["hard_gate", "advisory"] as const;
export type RuleSeverity = (typeof ruleSeverities)[number];

/** "$element" in a path or element reference means the element being checked by an each_element rule. */
export type RuleCondition =
  | { type: "always" }
  | { type: "field_in"; path: string; values: (string | boolean)[] }
  | { type: "element_status_in"; element: string; statuses: InspectionStatus[] }
  | { type: "rating_in"; element: string; ratings: ConditionRating[] }
  | { type: "observation_is_defect" }
  | { type: "all"; conditions: RuleCondition[] }
  | { type: "any"; conditions: RuleCondition[] };

export type RuleRequirement =
  | { type: "field_provided"; path: string }
  | { type: "field_answered"; path: string }
  | { type: "element_status_recorded"; element: string }
  | { type: "limitation_recorded"; element: string }
  | { type: "observation_location" }
  | { type: "observation_evidence"; min: number }
  | { type: "observation_next_action" };

const pathPattern = /^(\$element|[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)(\.[a-z][a-z0-9_]*)?$/;
const elementPattern = /^(\$element|[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/;

export const ruleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({ type: z.literal("field_in"), path: z.string().regex(pathPattern), values: z.array(z.union([z.string().max(60), z.boolean()])).min(1).max(20) }),
  z.object({ type: z.literal("element_status_in"), element: z.string().regex(elementPattern), statuses: z.array(z.enum(inspectionStatuses)).min(1) }),
  z.object({ type: z.literal("rating_in"), element: z.string().regex(elementPattern), ratings: z.array(z.enum(conditionRatings)).min(1) }),
  z.object({ type: z.literal("observation_is_defect") }),
  z.object({ type: z.literal("all"), conditions: z.array(ruleConditionSchema).min(1).max(10) }),
  z.object({ type: z.literal("any"), conditions: z.array(ruleConditionSchema).min(1).max(10) }),
]));

export const ruleRequirementSchema: z.ZodType<RuleRequirement> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("field_provided"), path: z.string().regex(pathPattern) }),
  z.object({ type: z.literal("field_answered"), path: z.string().regex(pathPattern) }),
  z.object({ type: z.literal("element_status_recorded"), element: z.string().regex(elementPattern) }),
  z.object({ type: z.literal("limitation_recorded"), element: z.string().regex(elementPattern) }),
  z.object({ type: z.literal("observation_location") }),
  z.object({ type: z.literal("observation_evidence"), min: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("observation_next_action") }),
]);

export const OTHER_OVERRIDE = "Other (explain in the note)";

export const ruleSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9-]{2,40}$/),
  title: z.string().min(1).max(160),
  scope: z.enum(["survey", "each_element", "each_observation"]),
  when: ruleConditionSchema,
  require: z.array(ruleRequirementSchema).min(1).max(10),
  severity: z.enum(ruleSeverities),
  /** Why the rule exists, shown with every failure. */
  justification: z.string().min(1).max(1000),
  /** Reasons a surveyor may record to proceed past a failing hard gate. Empty means it cannot be overridden. */
  overrideReasons: z.array(z.string().min(1).max(200)).max(10),
  serviceLevels: z.array(z.enum(serviceLevels)).optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const ruleSetSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  templateKey: z.string().max(80),
  /** Template versions this rule set was written and tested against. */
  templateVersions: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).min(1),
  reviewStatus: z.enum(["draft_requires_surveyor_review", "surveyor_reviewed"]),
  rules: z.array(ruleSchema).min(1).max(200),
}).superRefine((ruleSet, context) => {
  const ids = new Set<string>();
  for (const rule of ruleSet.rules) {
    if (ids.has(rule.id)) context.addIssue({ code: "custom", message: `Duplicate rule ${rule.id}` });
    ids.add(rule.id);
  }
});
export type RuleSet = z.infer<typeof ruleSetSchema>;

export const checkCategories = ["required_field", "inspection_status", "contradiction", "rule", "discrepancy", "ai_review", "suggestions", "report_photo", "reinspection", "report_approval"] as const;
export type CheckCategory = (typeof checkCategories)[number];

export type CheckItem = {
  /** Stable across runs for the same survey state, so overrides can refer to it. */
  id: string;
  category: CheckCategory;
  severity: RuleSeverity;
  status: "pass" | "fail";
  title: string;
  detail: string | null;
  ruleId: string | null;
  justification: string | null;
  fieldPath: string | null;
  elementKey: string | null;
  overrideReasons: string[];
};

export type CompletionReport = {
  ruleSetKey: string;
  ruleSetVersion: string;
  templateKey: string;
  templateVersion: string;
  serviceLevel: ServiceLevel;
  /** The full checklist, passing and failing. */
  items: CheckItem[];
  hardGateFailures: number;
  advisoryFailures: number;
  ready: boolean;
};

export type CompletionOverride = { itemId: string; reason: string; note?: string | null };
