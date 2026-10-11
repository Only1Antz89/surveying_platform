import { createHash } from "node:crypto";

export const surveyFileRetentionPolicy = {
  version: "survey-file-1-year-v2",
  years: 1,
} as const;

export type SurveyFileRetentionBasis = {
  archiveUntil?: Date | null;
  jobId: string;
  jobVersion: number;
  closedAt: Date | null;
  finalDeliveredAt: Date | null;
  jobClosed: boolean;
  legalHold: boolean;
  unresolvedComplaintOrClaim: boolean;
  practicePolicyApproved: boolean;
};

export type RetentionStageEvent = { fromStage: string | null; toStage: string; createdAt: Date };

/** A repeated archived-stage save must not restart the clock. Reopening does. */
export function surveyFileClosureDate(currentStage: string, events: readonly RetentionStageEvent[]): Date | null {
  if (currentStage !== "archived" || events.length === 0) return null;
  if (events.some(event => !Number.isFinite(event.createdAt.getTime()))) return null;
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let closedAt: Date | null = null;
  let stage: string | null = null;
  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index];
    // Equal-time competing transitions have no reliable ordering.
    if (index > 0 && event.createdAt.getTime() === ordered[index - 1].createdAt.getTime()
      && (event.toStage !== ordered[index - 1].toStage || event.fromStage !== ordered[index - 1].fromStage)) return null;
    if (stage !== null && event.fromStage !== stage) return null;
    if (event.toStage !== "archived") closedAt = null;
    else if (event.fromStage !== "archived") closedAt = new Date(event.createdAt);
    stage = event.toStage;
  }
  return stage === currentStage ? closedAt : null;
}

/** Calendar years in UTC, clamping 29 February to 28 February in non-leap years. */
export function surveyFileRetentionExpiry(anchor: Date): Date {
  if (!Number.isFinite(anchor.getTime())) throw new Error("A valid retention date is required.");
  const result = new Date(anchor);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + surveyFileRetentionPolicy.years);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result;
}

/** Eligibility for human review only; this result never authorises storage deletion. */
export function assessSurveyFileRetention(basis: SurveyFileRetentionBasis, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("A valid review time is required.");
  const dates = [basis.closedAt, basis.finalDeliveredAt, basis.archiveUntil ?? null];
  const validDates = dates.every(date => date === null || Number.isFinite(date.getTime()));
  const completeDates = validDates && basis.closedAt !== null && basis.finalDeliveredAt !== null;
  const anchor = completeDates
    ? new Date(Math.max(basis.closedAt!.getTime(), basis.finalDeliveredAt!.getTime()))
    : null;
  const defaultUntil = anchor ? surveyFileRetentionExpiry(anchor) : null;
  const retentionUntil = defaultUntil && basis.archiveUntil ? new Date(Math.max(defaultUntil.getTime(),basis.archiveUntil.getTime())) : defaultUntil;
  const reviewVersion = createHash("sha256").update(JSON.stringify({
    policy: surveyFileRetentionPolicy.version,
    ...basis,
    closedAt: basis.closedAt && Number.isFinite(basis.closedAt.getTime()) ? basis.closedAt.toISOString() : null,
    finalDeliveredAt: basis.finalDeliveredAt && Number.isFinite(basis.finalDeliveredAt.getTime()) ? basis.finalDeliveredAt.toISOString() : null,
    validDates,
  })).digest("hex");
  const reason = !basis.practicePolicyApproved ? "policy_approval_required"
    : basis.legalHold || basis.unresolvedComplaintOrClaim ? "protected"
    : !basis.jobClosed ? "job_open"
    : !anchor || anchor > now ? "date_review_required"
    : retentionUntil! > now ? "retention_active"
    : "manager_review_required";
  const daysUntilDeletionReview = retentionUntil ? Math.max(0,Math.ceil((retentionUntil.getTime()-now.getTime())/86_400_000)) : null;
  const archiveOffer = daysUntilDeletionReview !== null && daysUntilDeletionReview <= 30 && ["retention_active","manager_review_required"].includes(reason);
  return { archiveUntil:basis.archiveUntil??null, daysUntilDeletionReview, archiveOffer, policyVersion: surveyFileRetentionPolicy.version, anchor, retentionUntil, reviewVersion, reason,
    eligibleForManagerReview: reason === "manager_review_required", removalAuthorised: false as const };
}
