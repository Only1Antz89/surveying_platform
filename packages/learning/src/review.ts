import { z } from "zod";
import { containsIdentifiers, type SanitisedCase } from "./sanitise";

// Pipeline steps 4 and 5: privacy and technical review. Reviewers record
// decisions; the technical reviewer writes the generalised case that would be
// shared, with observation, suspected explanation, judgement and confirmed
// outcome kept as separate labels.

export const privacyChecks = [
  "identifiers_removed",
  "free_text_reviewed",
  "rare_combination_assessed",
  "linkage_listings_checked",
  "linkage_planning_checked",
  "linkage_other_public_checked",
] as const;
export type PrivacyCheck = (typeof privacyChecks)[number];

export const privacyCheckLabels: Record<PrivacyCheck, string> = {
  identifiers_removed: "Names, contacts, addresses, references, file names and coordinates are absent.",
  free_text_reviewed: "Every free-text field has been read; unique narratives are marked for rewriting.",
  rare_combination_assessed: "The combination of property type, age, element and rating is not distinctive in context.",
  linkage_listings_checked: "Could not be matched to a property listing using what remains.",
  linkage_planning_checked: "Could not be matched to planning or building control records.",
  linkage_other_public_checked: "Could not be matched to other public sources (EPC, street imagery, news), or across earlier releases.",
};

export const privacyDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  checks: z.array(z.enum(privacyChecks)).max(privacyChecks.length),
  note: z.string().trim().max(2000).nullable().optional(),
}).refine((input) => input.decision === "rejected" || privacyChecks.every((check) => input.checks.includes(check)), { message: "Every privacy check must be confirmed before approval.", path: ["checks"] })
  .refine((input) => input.decision === "approved" || Boolean(input.note?.trim()), { message: "Record why the case is rejected.", path: ["note"] });
export type PrivacyDecision = z.infer<typeof privacyDecisionSchema>;

const text = (max: number) => z.string().trim().min(3).max(max);

export const reviewedCaseSchema = z.object({
  observedFeature: z.string().trim().min(10).max(2000),
  possibleCauses: z.array(text(300)).max(8),
  confirmedCause: z.string().trim().max(500).nullable(),
  confirmationBasis: z.enum(["follow_up_inspection", "specialist_report"]).nullable(),
  surveyorJudgement: z.string().trim().min(10).max(2000),
  ratingExample: z.enum(["1", "2", "3", "NI"]).nullable(),
  nextSteps: z.array(text(300)).max(8),
  limitations: z.string().trim().max(1000).nullable(),
  uncertainty: z.enum(["low", "medium", "high"]),
  evidenceStrength: z.enum(["observed", "observed_with_photo", "reported_only"]),
  knowledgeReviewDue: z.iso.date(),
  ratingDisagreement: z.boolean(),
  noDefect: z.boolean(),
}).refine((input) => !input.confirmedCause || input.confirmationBasis !== null, { message: "A confirmed cause needs a follow-up inspection or specialist report; a client's account of a repair is not confirmation.", path: ["confirmationBasis"] });
export type ReviewedCase = z.infer<typeof reviewedCaseSchema>;

export const technicalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewed: reviewedCaseSchema.nullable(),
  note: z.string().trim().max(2000).nullable().optional(),
}).refine((input) => input.decision === "rejected" || input.reviewed !== null, { message: "Write the reviewed case before approving.", path: ["reviewed"] })
  .refine((input) => input.decision === "approved" || Boolean(input.note?.trim()), { message: "Record why the case is rejected.", path: ["note"] });
export type TechnicalDecision = z.infer<typeof technicalDecisionSchema>;

/** Text a reviewer wrote is scanned again; identifiers reintroduced by the rewrite block approval. */
export function reviewedCaseProblems(reviewed: ReviewedCase) {
  const fields: [string, string | null][] = [
    ["observedFeature", reviewed.observedFeature], ["confirmedCause", reviewed.confirmedCause], ["surveyorJudgement", reviewed.surveyorJudgement], ["limitations", reviewed.limitations],
    ...reviewed.possibleCauses.map((value, index) => [`possibleCauses.${index}`, value] as [string, string]),
    ...reviewed.nextSteps.map((value, index) => [`nextSteps.${index}`, value] as [string, string]),
  ];
  return fields.filter(([, value]) => value && containsIdentifiers(value)).map(([field]) => field);
}

/** The shared case: generalised context from sanitisation plus the reviewed labels. No lineage. */
export function sharedCaseFields(sanitised: SanitisedCase, reviewed: ReviewedCase) {
  return {
    jurisdiction: sanitised.jurisdiction,
    serviceLevel: sanitised.serviceLevel,
    template: sanitised.template,
    propertyType: sanitised.property.propertyType,
    builtForm: sanitised.property.builtForm,
    ageBand: sanitised.property.ageBand,
    elementKey: sanitised.elementKey,
    elementLabel: sanitised.elementLabel,
    inspectionStatus: sanitised.inspectionStatus,
    ...reviewed,
  };
}
