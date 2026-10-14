// Report review history derived from job stage events. Pure, so it can be tested
// without a database: submissions enter internal review, returns leave it for drafting
// and issues leave it for the client.

export type StageEvent = { jobId: string; reference: string; fromStage: string | null; toStage: string; reason: string | null; actor: string | null; at: Date };
export type ReviewReturn = { jobId: string; reference: string; at: string; reason: string | null; actor: string | null };
export type ReviewWaiting = { jobId: string; reference: string; since: string; hours: number };
export type ReviewSummary = { submitted: number; returned: number; issued: number; returnRate: number | null; medianReviewHours: number | null; returns: ReviewReturn[]; waiting: ReviewWaiting[] };

const hours = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 36e5 * 10) / 10;
const median = (values: number[]) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 10) / 10; };

export function summariseReviews(events: StageEvent[], now = new Date()): ReviewSummary {
  const byJob = new Map<string, StageEvent[]>();
  for (const event of events) byJob.set(event.jobId, [...(byJob.get(event.jobId) ?? []), event]);
  let submitted = 0, returned = 0, issued = 0;
  const durations: number[] = [], returns: ReviewReturn[] = [], waiting: ReviewWaiting[] = [];
  for (const list of byJob.values()) {
    const ordered = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    let enteredAt: Date | null = null;
    for (const event of ordered) {
      if (event.toStage === "internal_review" && event.fromStage !== "internal_review") { submitted++; enteredAt = event.at; continue; }
      if (event.fromStage !== "internal_review") continue;
      if (enteredAt) durations.push(hours(enteredAt, event.at));
      enteredAt = null;
      if (event.toStage === "issued") issued++;
      else if (["report_drafting", "inspection_complete", "scheduled"].includes(event.toStage)) { returned++; returns.push({ jobId: event.jobId, reference: event.reference, at: event.at.toISOString(), reason: event.reason, actor: event.actor }); }
    }
    const last = ordered.at(-1);
    if (enteredAt && last?.toStage === "internal_review") waiting.push({ jobId: last.jobId, reference: last.reference, since: enteredAt.toISOString(), hours: hours(enteredAt, now) });
  }
  const decided = returned + issued;
  return { submitted, returned, issued, returnRate: decided ? Math.round(returned / decided * 100) : null, medianReviewHours: median(durations), returns: returns.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50), waiting: waiting.sort((a, b) => b.hours - a.hours) };
}
