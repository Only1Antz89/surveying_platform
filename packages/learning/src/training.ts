// L4 is a gate, not a feature. Nothing in Surveynt trains a model. These checks
// define what would have to be true before a fine-tuning experiment could even
// be proposed, and which records could ever be used for one.

export type TrainingCandidate = {
  status: string;
  /** Current grant status for the model_training scope at the contributing firm. */
  modelTrainingGrant: { status: string; policyVersion: string } | null;
  currentPolicyVersion: string | null;
  releasedIn: string | null;
};

/** Only released, non-withdrawn cases from firms with a current model-training grant are ever eligible. */
export function trainingEligibility(item: TrainingCandidate) {
  const reasons: string[] = [];
  if (item.status !== "released") reasons.push(item.status === "withdrawn" ? "withdrawn" : "not_released");
  if (!item.releasedIn) reasons.push("not_in_a_release");
  if (!item.modelTrainingGrant || item.modelTrainingGrant.status !== "granted") reasons.push("no_model_training_grant");
  else if (item.modelTrainingGrant.policyVersion !== item.currentPolicyVersion) reasons.push("grant_policy_outdated");
  return { eligible: reasons.length === 0, reasons };
}

export type FineTuningGateInput = {
  providerRegistered: boolean;
  retrievalBaselineEvaluated: boolean;
  specificFailuresIdentified: boolean;
  measuredBenefitOverBaseline: boolean;
  memorisationAndLeakageTestsPassed: boolean;
  retirementAndRetrainingProcedureApproved: boolean;
  eligibleCases: number;
  minimumEligibleCases: number | null;
};

/** Every unmet condition for an optional fine-tuning experiment. */
export function fineTuningGate(input: FineTuningGateInput) {
  const reasons: string[] = [];
  if (!input.providerRegistered) reasons.push("No approved model provider in the platform register.");
  if (!input.retrievalBaselineEvaluated) reasons.push("The shared-retrieval baseline has not been evaluated on held-out cases.");
  if (!input.specificFailuresIdentified) reasons.push("No specific baseline failures have been identified that tuning could address.");
  if (!input.measuredBenefitOverBaseline) reasons.push("No measured benefit over the retrieval baseline.");
  if (!input.memorisationAndLeakageTestsPassed) reasons.push("Memorisation and privacy-leakage tests have not passed.");
  if (!input.retirementAndRetrainingProcedureApproved) reasons.push("The model retirement and retraining procedure is not approved.");
  if (input.minimumEligibleCases === null) reasons.push("Qualified reviewers have not set a minimum eligible corpus size.");
  else if (input.eligibleCases < input.minimumEligibleCases) reasons.push(`Only ${input.eligibleCases} eligible cases; ${input.minimumEligibleCases} required.`);
  return { allowed: reasons.length === 0, reasons };
}
