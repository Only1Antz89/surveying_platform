import { contributionScopes, programmeStatus } from "@surveynt/learning";
import { ok, problem } from "./api";
import { LearningError } from "./learning";

/** Maps shared-learning refusals to problem responses. */
export async function learningRoute<T>(work: () => Promise<T>) {
  try {
    return ok(await work());
  } catch (reason) {
    if (reason instanceof LearningError) return problem(reason.status, reason.code, reason.message);
    throw reason;
  }
}

/** Demo workspaces never contribute: the programme reads as inactive and nothing is recorded. */
export function demoLearningDashboard() {
  const status = programmeStatus({}, null);
  return { programme: { active: false, reasons: status.reasons, policy: null }, scopes: contributionScopes.map((scope) => ({ scope, status: "not_granted", policyVersion: null, outdated: false, since: null })), grants: [], withdrawals: [], counts: [] };
}
