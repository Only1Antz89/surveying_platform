import { contributionConfirmations, type ContributionScope, type ProgrammeStatus } from "./policy";

export type ContributionGrant = { scope: string; status: string; policyVersion: string; confirmations: string[]; createdAt: Date | string };
export type WithdrawalRequest = { scope: string | null; jobId: string | null; createdAt: Date | string };

export type EligibilityInput = {
  programme: ProgrammeStatus;
  scope: ContributionScope;
  /** The firm's grant history; the latest record per scope is the current one. */
  grants: ContributionGrant[];
  withdrawals: WithdrawalRequest[];
  jobId: string;
  survey: { status: string; signedOff: boolean; jurisdiction: string | null };
};

export type EligibilityReason = { code: string; message: string };

const time = (value: Date | string) => new Date(value).getTime();

/** The current grant for a scope: the most recent record, granted or revoked. */
export function currentGrant<T extends ContributionGrant>(grants: T[], scope: ContributionScope): T | null {
  return grants.filter((grant) => grant.scope === scope).sort((a, b) => time(b.createdAt) - time(a.createdAt))[0] ?? null;
}

/**
 * Pipeline step 1. A survey's material may be copied into restricted staging
 * for one scope only when every condition holds; the default answer is no.
 */
export function evaluateEligibility(input: EligibilityInput): { eligible: boolean; reasons: EligibilityReason[] } {
  const reasons: EligibilityReason[] = [];
  if (!input.programme.active) reasons.push({ code: "programme_inactive", message: "The shared learning programme is not active." });
  const grant = currentGrant(input.grants, input.scope);
  if (!grant || grant.status !== "granted") reasons.push({ code: "scope_not_granted", message: "The firm has not granted this contribution scope." });
  else {
    if (input.programme.policyVersion && grant.policyVersion !== input.programme.policyVersion) reasons.push({ code: "grant_policy_outdated", message: "The grant was given under an earlier policy version. The firm must confirm the current one." });
    const missing = contributionConfirmations.filter((item) => !grant.confirmations.includes(item));
    if (missing.length) reasons.push({ code: "confirmations_missing", message: `The grant lacks confirmations: ${missing.join(", ")}.` });
  }
  if (input.withdrawals.some((request) => request.jobId === input.jobId && (request.scope === null || request.scope === input.scope))) reasons.push({ code: "job_withdrawn", message: "The firm withdrew this job from shared learning." });
  if (grant && input.withdrawals.some((request) => request.jobId === null && (request.scope === null || request.scope === input.scope) && time(request.createdAt) >= time(grant.createdAt))) reasons.push({ code: "scope_withdrawn", message: "The firm withdrew this scope after granting it." });
  if (!input.survey.signedOff || input.survey.status !== "approved") reasons.push({ code: "survey_not_signed_off", message: "Only surveys with a signed-off report are considered." });
  if (!input.survey.jurisdiction) reasons.push({ code: "jurisdiction_missing", message: "The survey has no jurisdiction; guidance differs between nations." });
  return { eligible: reasons.length === 0, reasons };
}
