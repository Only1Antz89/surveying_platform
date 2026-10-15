import { aiUseLabels, type AiUse } from "@surveynt/assistant";

// What still stands between a practice and a working SurvAI. Each step names
// who can complete it; nothing here grants or bypasses an approval.

export type ReadinessOwner = "platform" | "practice" | "client";
export type ReadinessStep = { key: string; label: string; detail: string; owner: ReadinessOwner; done: boolean };
export type SurvaiReadiness = { businessReady: boolean; caseReady: boolean; steps: ReadinessStep[] };

export type SurvaiReadinessInput = {
  connection: { providerKey: string | null; modelId: string | null } | null;
  register: { providerKey: string; modelId: string; uses: string[]; status: string }[];
  settings: { aiFeaturesEnabled: boolean; permittedUses: string[]; disclosureText: string | null } | null;
  riskAssessments: { use: string; status: string; reviewDue: string | null }[];
  openIncidents: { severity: string; status: string }[];
  today: string;
};

const survaiUses = ["business_chat", "case_chat"] as const satisfies readonly AiUse[];

export function survaiReadiness(input: SurvaiReadinessInput): SurvaiReadiness {
  const { connection, settings } = input;
  const label = (use: AiUse) => aiUseLabels[use].toLowerCase();
  const approved = (use: AiUse) => Boolean(connection?.providerKey && connection.modelId && input.register.some((entry) => entry.providerKey === connection.providerKey && entry.modelId === connection.modelId && entry.status === "approved" && entry.uses.includes(use)));
  const assessed = (use: AiUse) => input.riskAssessments.some((item) => item.use === use && item.status === "approved" && (!item.reviewDue || item.reviewDue >= input.today));
  const steps: ReadinessStep[] = [
    { key: "connection", owner: "platform", done: Boolean(connection?.providerKey && connection.modelId), label: "AI connection enabled for this practice",
      detail: connection ? "A platform-approved SurvAI connection is selected." : "Surveynt platform staff enable an AI connection and select it for this practice (Platform → Connections)." },
    ...survaiUses.map((use): ReadinessStep => ({ key: `model:${use}`, owner: "platform", done: approved(use), label: `Model approved for ${label(use)}`,
      detail: connection?.modelId ? `Platform compliance approves ${connection.providerKey} · ${connection.modelId} for this use in the model register, with recorded evaluation results.` : "Needs an AI connection first." })),
    { key: "firm_enabled", owner: "practice", done: Boolean(settings?.aiFeaturesEnabled), label: "AI features allowed for the practice", detail: "An owner or administrator turns on AI features below." },
    { key: "disclosure", owner: "practice", done: Boolean(settings?.disclosureText), label: "Client disclosure written", detail: "Explain to clients what SurvAI is used for, that a surveyor reviews every output, and how to decline." },
    ...survaiUses.map((use): ReadinessStep => ({ key: `permitted:${use}`, owner: "practice", done: Boolean(settings?.permittedUses.includes(use)), label: `${aiUseLabels[use]} permitted`, detail: "Tick this use under Permitted uses." })),
    ...survaiUses.map((use): ReadinessStep => ({ key: `risk:${use}`, owner: "practice", done: assessed(use), label: `Risk assessment approved for ${label(use)}`, detail: "Draft an assessment below; an owner or administrator approves it. It must stay within its review date." })),
    { key: "incidents", owner: "practice", done: !input.openIncidents.some((item) => item.severity === "critical" && item.status !== "closed" && item.status !== "corrected"), label: "No open critical AI incident", detail: "An open critical incident suspends AI use until it is corrected and closed." },
  ];
  const ready = (use: AiUse) => steps.filter((step) => !step.key.includes(":") || step.key.endsWith(`:${use}`)).every((step) => step.done);
  const businessReady = ready("business_chat");
  const caseReady = ready("case_chat");
  steps.push({ key: "case_consent", owner: "client", done: false, label: "Client consent on each case", detail: "Case conversations also need the client's consent, recorded on each job against the current disclosure. Business conversations do not." });
  return { businessReady, caseReady, steps };
}
