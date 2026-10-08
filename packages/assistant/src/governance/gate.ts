import { getAssistantModel, type AssistantModel } from "../proposals/model";

// AI governance gate. A model may be used for one purpose on one job only when
// every condition holds. The default answer is no, with the reasons listed.

export const aiUses = ["field_proposals", "photo_observation", "document_extraction", "report_prose", "case_chat", "business_chat", "platform_chat"] as const;
export type AiUse = (typeof aiUses)[number];

export const aiUseLabels: Record<AiUse, string> = {
  case_chat:"Case conversation",
  business_chat:"Business conversation",
  platform_chat:"Platform operations conversation",
  field_proposals: "Field suggestions from records",
  photo_observation: "Photo descriptions",
  document_extraction: "Document reading (OCR and extraction)",
  report_prose: "Drafted report text",
};

export type AiGateInput = {
  /** The deployment's AI_PROVIDER setting; "none" until a provider is chosen. */
  providerKey: string;
  register: { providerKey: string; modelId: string; modelVersion: string; uses: string[]; status: string }[];
  settings: { aiFeaturesEnabled: boolean; permittedUses: string[]; disclosureVersion: number } | null;
  riskAssessments: { use: string; status: string; reviewDue: string | null }[];
  /** The most recent consent record for the job, if any. */
  consent: { status: string; uses: string[]; disclosureVersion: number } | null;
  openIncidents: { severity: string; status: string }[];
  /** ISO date used for review-due checks. */
  today: string;
};

export type AiGateReason = { code: string; message: string };
export type AiGateResult = { use: AiUse; allowed: boolean; model: { providerKey: string; modelId: string; modelVersion: string } | null; reasons: AiGateReason[] };

export function evaluateAiGate(input: AiGateInput, use: AiUse): AiGateResult {
  const reasons: AiGateReason[] = [];
  const label = aiUseLabels[use].toLowerCase();
  const model = input.register.find((entry) => entry.providerKey === input.providerKey && entry.status === "approved" && entry.uses.includes(use)) ?? null;
  if (!input.providerKey || input.providerKey === "none") reasons.push({ code: "provider_none", message: "No AI provider is configured for this deployment." });
  else if (!model) reasons.push({ code: "not_registered", message: `The configured provider has no approved model for ${label} in the platform model register.` });
  if (!input.settings?.aiFeaturesEnabled) reasons.push({ code: "firm_disabled", message: "AI features are turned off for this firm." });
  else if (!input.settings.permittedUses.includes(use)) reasons.push({ code: "use_not_permitted", message: `The firm has not permitted ${label}.` });
  const assessment = input.riskAssessments.find((item) => item.use === use && item.status === "approved");
  if (!assessment) reasons.push({ code: "no_risk_assessment", message: `No approved risk assessment covers ${label}.` });
  else if (assessment.reviewDue && assessment.reviewDue < input.today) reasons.push({ code: "risk_review_overdue", message: `The risk assessment for ${label} is past its review date.` });
  if(use !== "business_chat" && use !== "platform_chat") {
  if (!input.consent) reasons.push({ code: "no_consent", message: "No AI consent is recorded for this job." });
  else if (input.consent.status !== "granted") reasons.push({ code: "consent_withdrawn", message: "AI consent for this job has been withdrawn." });
  else if (!input.consent.uses.includes(use)) reasons.push({ code: "consent_scope", message: `The job's consent does not cover ${label}.` });
  else if (input.settings && input.consent.disclosureVersion < input.settings.disclosureVersion) reasons.push({ code: "consent_disclosure_outdated", message: "Consent was given against an earlier version of the firm's AI disclosure. Ask again." });
  }
  if (input.openIncidents.some((incident) => incident.severity === "critical" && incident.status !== "closed" && incident.status !== "corrected")) reasons.push({ code: "open_critical_incident", message: "An open critical AI incident suspends AI use for this firm." });
  return { use, allowed: reasons.length === 0, model: reasons.length ? null : { providerKey: model!.providerKey, modelId: model!.modelId, modelVersion: model!.modelVersion }, reasons };
}

/** The only supported way to get a model: blocked models report "unavailable" with the gate's reasons. */
export function getGovernedModel(env: Record<string, string | undefined>, gate: AiGateResult): AssistantModel {
  if (gate.allowed) return getAssistantModel(env);
  const reason = gate.reasons.map((item) => item.message).join(" ");
  return { id: "blocked", available: false, async propose() { return { status: "unavailable", reason }; } };
}
