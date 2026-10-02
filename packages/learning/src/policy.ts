import { z } from "zod";

// Shared learning is off by default. Three independent switches must agree
// before anything is copied out of a firm's workspace: the platform flag, a
// published contribution policy with defined release criteria, and the firm's
// own grant for the specific scope with its authority confirmations.

export const contributionScopes = ["structured_cases", "photos", "evaluation", "model_training"] as const;
export type ContributionScope = (typeof contributionScopes)[number];

export const scopeLabels: Record<ContributionScope, string> = {
  structured_cases: "Structured cases",
  photos: "Photos",
  evaluation: "Evaluation sets",
  model_training: "Model training",
};

export const scopeDescriptions: Record<ContributionScope, string> = {
  structured_cases: "Minimal element observations, ratings and next steps from signed-off surveys, generalised and reviewed before any release.",
  photos: "Defect photos, stripped of metadata and cropped. Excluded from releases until a reviewed cropping tool exists.",
  evaluation: "Use of contributed cases in held-out test sets that measure the assistant. Never used for training.",
  model_training: "Eligibility for a future, separately approved fine-tuning experiment. Nothing is trained today.",
};

/** What a firm confirms, in its own words, before a scope is granted. A switch alone is not enough. */
export const contributionConfirmations = ["client_information_authority", "third_party_rights", "policy_accepted"] as const;
export type ContributionConfirmation = (typeof contributionConfirmations)[number];

export const confirmationStatements: Record<ContributionConfirmation, string> = {
  client_information_authority: "Our terms with clients, and our privacy notice, permit us to contribute information from their surveys for this purpose, and we have recorded where.",
  third_party_rights: "We hold the rights to contribute the photos, documents and wording involved, or they are excluded.",
  policy_accepted: "We have read this version of the contribution policy, including how withdrawal works.",
};

/** Release criteria are professional judgements recorded by qualified reviewers; the code only enforces what they set. */
export const releaseCriteriaSchema = z.object({
  definedBy: z.string().trim().min(3).max(500),
  minimumCasesPerRelease: z.number().int().min(1),
  maxContributorShare: z.number().gt(0).max(1),
  rareCombinationReviewBelow: z.number().int().min(2),
  minimumTechnicalAgreement: z.number().min(0).max(1).nullable(),
  coverageDimensions: z.array(z.enum(["jurisdiction", "serviceLevel", "propertyType", "ageBand", "elementKey", "rating"])).min(1),
  licenceScope: z.string().trim().min(10).max(1000),
});
export type ReleaseCriteria = z.infer<typeof releaseCriteriaSchema>;

export type PolicyVersion = { version: string; status: string; privacyAssessmentRef: string | null; releaseCriteria: unknown };
export type ProgrammeReason = { code: "flag_off" | "no_published_policy" | "privacy_assessment_missing" | "release_criteria_undefined"; message: string };
export type ProgrammeStatus = { active: boolean; policyVersion: string | null; criteria: ReleaseCriteria | null; reasons: ProgrammeReason[] };

/** Whether the shared learning programme may run at all. Every reason is listed. */
export function programmeStatus(env: Record<string, string | undefined>, policy: PolicyVersion | null): ProgrammeStatus {
  const reasons: ProgrammeReason[] = [];
  if (env.SHARED_LEARNING_ENABLED !== "true") reasons.push({ code: "flag_off", message: "Shared learning is switched off for this deployment (SHARED_LEARNING_ENABLED)." });
  const published = policy?.status === "published" ? policy : null;
  if (!published) reasons.push({ code: "no_published_policy", message: "No contribution policy has been published." });
  if (published && !published.privacyAssessmentRef) reasons.push({ code: "privacy_assessment_missing", message: "The published policy has no approved privacy assessment reference." });
  const criteria = published ? releaseCriteriaSchema.safeParse(published.releaseCriteria) : null;
  if (published && !criteria?.success) reasons.push({ code: "release_criteria_undefined", message: "Release criteria have not been set by qualified reviewers." });
  return { active: reasons.length === 0, policyVersion: published?.version ?? null, criteria: criteria?.success ? criteria.data : null, reasons };
}
