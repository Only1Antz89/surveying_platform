import { describe, expect, it } from "vitest";
import { summariseReviews, type StageEvent } from "./review-history-model";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const event = (jobId: string, fromStage: string | null, toStage: string, hour: number, reason: string | null = null): StageEvent => ({ jobId, reference: jobId.toUpperCase(), fromStage, toStage, reason, actor: "Senior Surveyor", at: at(hour) });

describe("report review history", () => {
  it("counts submissions, returns with reasons, issues and the median time in review", () => {
    const summary = summariseReviews([
      event("a", "report_drafting", "internal_review", 0), event("a", "internal_review", "report_drafting", 4, "Roof limitation missing"), event("a", "report_drafting", "internal_review", 10), event("a", "internal_review", "issued", 12),
      event("b", "report_drafting", "internal_review", 1), event("b", "internal_review", "issued", 7),
    ], at(20));
    expect(summary).toMatchObject({ submitted: 3, returned: 1, issued: 2, returnRate: 33, medianReviewHours: 4 });
    expect(summary.returns[0]).toMatchObject({ reference: "A", reason: "Roof limitation missing" });
    expect(summary.waiting).toEqual([]);
  });
  it("lists reports still waiting for review, longest first, and handles no decisions", () => {
    const summary = summariseReviews([event("c", "report_drafting", "internal_review", 2), event("d", "report_drafting", "internal_review", 8)], at(20));
    expect(summary.waiting.map((item) => [item.reference, item.hours])).toEqual([["C", 18], ["D", 12]]);
    expect(summary.returnRate).toBeNull();
    expect(summary.medianReviewHours).toBeNull();
  });
});
