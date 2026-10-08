import { describe, expect, it } from "vitest";
import { assessSurveyFileRetention, surveyFileClosureDate, surveyFileRetentionExpiry, type SurveyFileRetentionBasis } from "./survey-file-retention";

const basis: SurveyFileRetentionBasis = {
  jobId: "job-1", jobVersion: 3, closedAt: new Date("2000-03-01T12:00:00Z"),
  finalDeliveredAt: new Date("2000-02-01T12:00:00Z"), jobClosed: true,
  legalHold: false, unresolvedComplaintOrClaim: false, practicePolicyApproved: true,
};
const now = new Date("2020-01-01T00:00:00Z");
describe("survey file retention policy", () => {
  it("uses the latest genuine closure, ignoring repeated archive saves", () => {
    const events = [
      { fromStage: "issued", toStage: "archived", createdAt: new Date("2000-01-01T00:00:00Z") },
      { fromStage: "archived", toStage: "archived", createdAt: new Date("2001-01-01T00:00:00Z") },
      { fromStage: "archived", toStage: "report_drafting", createdAt: new Date("2002-01-01T00:00:00Z") },
      { fromStage: "report_drafting", toStage: "archived", createdAt: new Date("2003-01-01T00:00:00Z") },
    ];
    expect(surveyFileClosureDate("archived", events.slice(0, 2))?.toISOString()).toBe("2000-01-01T00:00:00.000Z");
    expect(surveyFileClosureDate("archived", [...events].reverse())?.toISOString()).toBe("2003-01-01T00:00:00.000Z");
    expect(surveyFileClosureDate("report_drafting", events.slice(0, 3))).toBeNull();
  });
  it("requires review for missing, inconsistent or ambiguous closure history", () => {
    const date = new Date("2000-01-01T00:00:00Z");
    expect(surveyFileClosureDate("archived", [])).toBeNull();
    expect(surveyFileClosureDate("archived", [{ fromStage: "archived", toStage: "archived", createdAt: date }])).toBeNull();
    expect(surveyFileClosureDate("archived", [
      { fromStage: "issued", toStage: "archived", createdAt: date },
      { fromStage: "archived", toStage: "issued", createdAt: date },
    ])).toBeNull();
    expect(surveyFileClosureDate("archived", [
      { fromStage: "issued", toStage: "archived", createdAt: date },
      { fromStage: "issued", toStage: "archived", createdAt: new Date("2001-01-01T00:00:00Z") },
    ])).toBeNull();
  });
  it("uses the later closure or final delivery and requires human review", () => {
    const result = assessSurveyFileRetention(basis, now);
    expect(result.retentionUntil?.toISOString()).toBe("2001-03-01T12:00:00.000Z");
    expect(result.eligibleForManagerReview).toBe(true);
    expect(result.removalAuthorised).toBe(false);
    expect(assessSurveyFileRetention({ ...basis, finalDeliveredAt: new Date("2019-07-01T00:00:00Z") }, now).reason).toBe("retention_active");
  });
  it("clamps leap days and preserves the UTC time", () => {
    expect(surveyFileRetentionExpiry(new Date("2000-02-29T23:45:12.123Z")).toISOString()).toBe("2001-02-28T23:45:12.123Z");
  });
  it("becomes reviewable exactly at expiry", () => {
    expect(assessSurveyFileRetention(basis, new Date("2001-03-01T11:59:59.999Z")).reason).toBe("retention_active");
    expect(assessSurveyFileRetention(basis, new Date("2001-03-01T12:00:00Z")).reason).toBe("manager_review_required");
  });
  it("holds missing, invalid and future dates", () => {
    for (const closedAt of [null, new Date("invalid"), new Date("2030-01-01Z")]) {
      expect(assessSurveyFileRetention({ ...basis, closedAt }, now).reason).toBe("date_review_required");
    }
    expect(assessSurveyFileRetention({ ...basis, finalDeliveredAt: null }, now).reason).toBe("date_review_required");
  });
  it("holds open jobs, claims, legal holds and unapproved practice policies", () => {
    expect(assessSurveyFileRetention({ ...basis, jobClosed: false }, now).reason).toBe("job_open");
    expect(assessSurveyFileRetention({ ...basis, legalHold: true }, now).reason).toBe("protected");
    expect(assessSurveyFileRetention({ ...basis, unresolvedComplaintOrClaim: true }, now).reason).toBe("protected");
    expect(assessSurveyFileRetention({ ...basis, practicePolicyApproved: false }, now).reason).toBe("policy_approval_required");
  });
  it("invalidates reviewed versions after job, delivery, hold or policy changes", () => {
    const previous = assessSurveyFileRetention(basis, now).reviewVersion;
    for (const change of [{ jobVersion: 4 }, { jobClosed: false }, { finalDeliveredAt: new Date("2001-01-01Z") },
      { legalHold: true }, { unresolvedComplaintOrClaim: true }, { practicePolicyApproved: false }]) {
      expect(assessSurveyFileRetention({ ...basis, ...change }, now).reviewVersion).not.toBe(previous);
    }
    expect(assessSurveyFileRetention(basis, new Date("2021-01-01Z")).reviewVersion).toBe(previous);
  });
});
