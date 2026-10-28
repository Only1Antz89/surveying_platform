import { z } from "zod";

export const lifecycleStages = [
  "setup",
  "ready",
  "trial",
  "subscribed",
  "billing_attention",
  "offboarding",
] as const;
export const stageLabels: Record<string, string> = {
  setup: "Setting up",
  ready: "Ready for subscription",
  trial: "Trial",
  subscribed: "Subscribed",
  billing_attention: "Billing attention",
  offboarding: "Offboarding / closed",
};
export const stepLabels: Record<string, string> = {
  practice_details: "Practice details",
  report_templates: "Report templates",
  billing: "Subscription setup",
  services: "Services",
  first_teammate: "First teammate",
};
export const followupKinds = [
  "onboarding",
  "sales",
  "retention",
  "offboarding",
] as const;
export function canManageEngagement(role: string) {
  return ["super_admin", "support", "billing"].includes(role);
}
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Choose a valid date.",
  );
export const followupInput = z.object({
  requestId: z.uuid(),
  targetType: z.enum(["customer", "prospect"]),
  targetId: z.uuid(),
  kind: z.enum(followupKinds),
  assigneeId: z.uuid(),
  dueDate: calendarDate,
  note: z.string().trim().min(5).max(1000),
});
export const completeFollowupInput = z.object({
  outcome: z.enum([
    "contacted",
    "progressed",
    "no_response",
    "not_interested",
    "offboarding_complete",
    "cancelled",
  ]),
  note: z.string().trim().min(5).max(1000),
});
export type LifecycleAccount = {
  id: string;
  is_demo?: boolean;
  name: string;
  owner: string | null;
  created_at: string;
  status: string;
  subscription: string | null;
  cancel_at_period_end: boolean;
  trial_ends_at: string | null;
  last_activity: string | null;
  steps: { key: string; completed_at: string | null }[];
  members: number;
  jobs: number;
  checkout_at: string | null;
};
export function lifecycle(account: LifecycleAccount, now = new Date()) {
  const incomplete = account.steps.filter((s) => !s.completed_at);
  const offboarding =
    account.cancel_at_period_end ||
    account.status === "closed" ||
    account.subscription === "canceled";
  const stage = offboarding
    ? "offboarding"
    : ["past_due", "unpaid"].includes(account.subscription ?? "")
      ? "billing_attention"
      : account.subscription === "active"
        ? "subscribed"
        : account.subscription === "trialing"
          ? "trial"
          : !account.owner ||
              !account.members ||
              !account.steps.some(
                (s) => s.key === "practice_details" && s.completed_at,
              )
            ? "setup"
            : "ready";
  // Account age is the fallback only where there is no recorded human activity.
  const inactiveDays = Math.max(
    0,
    Math.floor(
      (now.getTime() -
        Date.parse(account.last_activity ?? account.created_at)) /
        86400000,
    ),
  );
  const trialDays = account.trial_ends_at
    ? Math.ceil((Date.parse(account.trial_ends_at) - now.getTime()) / 86400000)
    : null;
  const stalled = ["setup", "ready"].includes(stage) && inactiveDays >= 3;
  const trialEnding = stage === "trial" && trialDays !== null && trialDays <= 7;
  const inactive =
    ["trial", "subscribed"].includes(stage) && inactiveDays >= 14;
  const nextStep =
    account.status === "closed"
      ? "Confirm handover and retention requirements"
      : account.status === "suspended"
        ? "Review the suspension reason before arranging support"
        : offboarding
          ? "Agree handover, export and access-removal dates"
          : stage === "billing_attention"
            ? "Review payment issue in billing"
            : !account.owner || !account.members
              ? "Help the invited owner accept workspace access"
              : trialEnding
                ? "Review trial outcomes and readiness to continue"
                : !account.steps.length
                  ? "Confirm the setup checklist and provisioning status"
                  : stage === "ready"
                    ? account.checkout_at
                      ? "Follow up on the recorded checkout attempt"
                      : "Help owner complete subscription setup"
                    : incomplete.length
                      ? `Help complete ${stepLabels[incomplete[0].key] ?? incomplete[0].key}`
                      : !account.jobs
                        ? "Help customer create their first job"
                        : inactive
                          ? "Arrange an adoption check-in"
                          : "Review adoption and next steps";
  return {
    stage,
    inactiveDays,
    trialDays,
    stalled,
    trialEnding,
    inactive,
    nextStep,
    completed: account.steps.length - incomplete.length,
    total: account.steps.length,
    attention:
      offboarding ||
      account.status === "suspended" ||
      stage === "billing_attention" ||
      stalled ||
      trialEnding ||
      inactive,
  };
}
export function londonDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
