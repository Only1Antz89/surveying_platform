import { describe, it, expect } from "vitest";
import {
  lifecycle,
  londonDay,
  followupInput,
  canManageEngagement,
  type LifecycleAccount,
} from "./customer-lifecycle";
const now = new Date("2026-10-28T12:00:00Z");
const base: LifecycleAccount = {
  id: "a",
  name: "Firm",
  owner: "owner@example.test",
  created_at: "2026-10-20T12:00:00Z",
  status: "provisioning",
  subscription: null,
  cancel_at_period_end: false,
  trial_ends_at: null,
  last_activity: null,
  steps: [
    { key: "practice_details", completed_at: "2026-10-20T12:00:00Z" },
    { key: "billing", completed_at: null },
  ],
  members: 1,
  jobs: 0,
  checkout_at: null,
};
describe("customer lifecycle signals", () => {
  it("uses actual steps and a missing billing step as ready to subscribe", () => {
    expect(lifecycle(base, now)).toMatchObject({
      stage: "ready",
      stalled: true,
      completed: 1,
      total: 2,
      inactiveDays: 8,
    });
  });
  it("does not block subscription handoff on post-signup adoption steps", () => {
    expect(
      lifecycle(
        {
          ...base,
          steps: [
            ...base.steps,
            { key: "first_teammate", completed_at: null },
            { key: "report_templates", completed_at: null },
          ],
        },
        now,
      ).stage,
    ).toBe("ready");
  });
  it("never treats missing steps as completed onboarding", () => {
    expect(lifecycle({ ...base, steps: [] }, now)).toMatchObject({
      stage: "setup",
      total: 0,
    });
  });
  it("flags pending owner acceptance and names the next step", () => {
    expect(lifecycle({ ...base, members: 0 }, now).nextStep).toContain(
      "invited owner",
    );
  });
  it("gives a recorded checkout attempt a different next action", () => {
    expect(
      lifecycle({ ...base, checkout_at: now.toISOString() }, now).nextStep,
    ).toContain("checkout attempt");
  });
  it("distinguishes trial deadline and inactivity from setup abandonment", () => {
    expect(
      lifecycle(
        {
          ...base,
          subscription: "trialing",
          trial_ends_at: "2026-10-30T12:00:00Z",
          last_activity: "2026-10-01T12:00:00Z",
        },
        now,
      ),
    ).toMatchObject({
      stage: "trial",
      stalled: false,
      trialEnding: true,
      inactive: true,
    });
  });
  it("prioritises cancellation over active status and incomplete setup", () => {
    expect(
      lifecycle(
        { ...base, subscription: "active", cancel_at_period_end: true },
        now,
      ).stage,
    ).toBe("offboarding");
  });
  it("does not describe suspended access as healthy", () => {
    expect(
      lifecycle(
        {
          ...base,
          status: "suspended",
          subscription: "active",
          last_activity: now.toISOString(),
        },
        now,
      ),
    ).toMatchObject({
      attention: true,
      nextStep: "Review the suspension reason before arranging support",
    });
  });
  it("flags billing failures without inventing revenue or subscription history", () => {
    expect(lifecycle({ ...base, subscription: "unpaid" }, now).stage).toBe(
      "billing_attention",
    );
  });
  it("uses London calendar dates across BST boundaries", () => {
    expect(londonDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(londonDay(new Date("2026-10-28T23:30:00Z"))).toBe("2026-10-28");
  });
  it("rejects invalid dates and browser supplied roles", () => {
    const input = {
      requestId: crypto.randomUUID(),
      targetType: "customer",
      targetId: crypto.randomUUID(),
      kind: "sales",
      assigneeId: crypto.randomUUID(),
      note: "Arrange an introduction",
      dueDate: "2026-02-30",
      role: "super_admin",
    };
    expect(followupInput.safeParse(input).success).toBe(false);
    const parsed = followupInput.parse({ ...input, dueDate: "2026-10-29" });
    expect(parsed).not.toHaveProperty("role");
  });
  it("restricts engagement to customer-facing platform roles", () => {
    expect(canManageEngagement("support")).toBe(true);
    expect(canManageEngagement("billing")).toBe(true);
    expect(canManageEngagement("owner")).toBe(false);
    expect(canManageEngagement("compliance")).toBe(false);
  });
});
