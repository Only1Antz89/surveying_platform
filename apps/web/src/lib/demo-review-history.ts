import type { ReviewSummary } from "./review-history-model";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 36e5).toISOString();
/** Fictional review activity for the local preview. */
export const demoReviewSummary = (): ReviewSummary => ({
  submitted: 14, returned: 3, issued: 10, returnRate: 23, medianReviewHours: 19,
  waiting: [{ jobId: "job_02", reference: "SVY-1047", since: hoursAgo(30), hours: 30 }],
  returns: [
    { jobId: "job_03", reference: "SVY-1046", at: hoursAgo(52), reason: "Roof limitation not recorded for the rear slope.", actor: "Oliver Grant" },
    { jobId: "job_05", reference: "SVY-1044", at: hoursAgo(190), reason: "Damp readings need a location for each reading.", actor: "Oliver Grant" },
  ],
});
