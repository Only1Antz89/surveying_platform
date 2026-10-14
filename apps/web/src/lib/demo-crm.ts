import { defaultTemplates, messageKeys } from "./client-messages-model";
import type { ReferralSource } from "./referrals";
import type { TemplateView } from "./client-messages";

/** Fictional CRM data for the local preview. */
export const demoReferralSources: ReferralSource[] = [
  { id: "ref-1", name: "Clifton Homes (fictional agent)", kind: "estate_agent", email: null, active: true },
  { id: "ref-2", name: "Harbour Mortgages (fictional broker)", kind: "mortgage_broker", email: null, active: true },
  { id: "ref-3", name: "Practice website", kind: "website", email: null, active: true },
  { id: "ref-4", name: "Repeat client", kind: "repeat_client", email: null, active: true },
];
export const demoReferralReport = () => ({ report: [{ source: demoReferralSources[0], jobs: 18, feesMinor: 2_154_000, issued: 15 }, { source: demoReferralSources[2], jobs: 11, feesMinor: 1_045_500, issued: 9 }, { source: demoReferralSources[1], jobs: 7, feesMinor: 812_000, issued: 6 }, { source: demoReferralSources[3], jobs: 4, feesMinor: 398_000, issued: 4 }], untracked: { jobs: 5, feesMinor: 455_000, issued: 3 }, total: 45, since: new Date(Date.now() - 365 * 86_400_000).toISOString() });
export const demoTemplates = (): { templates: TemplateView[]; reviewRequests: { enabled: boolean; reviewUrl: string | null; delayDays: number }; smsConnected: boolean } => ({
  templates: messageKeys.flatMap((key) => [{ key, channel: "email" as const, subject: defaultTemplates[key].subject, body: defaultTemplates[key].body, enabled: key !== "review_request", customised: false }, { key, channel: "sms" as const, subject: null, body: defaultTemplates[key].sms, enabled: false, customised: false }]),
  reviewRequests: { enabled: false, reviewUrl: null, delayDays: 2 }, smsConnected: false,
});
