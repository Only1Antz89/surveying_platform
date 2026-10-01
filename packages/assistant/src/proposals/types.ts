import type { FieldValue } from "../forms/types";

export const proposalReviewStates = ["pending", "accepted", "edited", "rejected", "superseded"] as const;
export type ProposalReviewState = (typeof proposalReviewStates)[number];

export const proposalOrigins = ["external_record", "job_record", "prior_survey", "document_extraction", "image_analysis", "model_draft"] as const;
export type ProposalOrigin = (typeof proposalOrigins)[number];

export const proposalOriginLabels: Record<ProposalOrigin, string> = {
  external_record: "Sourced from an external record: unverified",
  job_record: "From the job record: confirm",
  prior_survey: "From an earlier survey: historical",
  document_extraction: "Extracted from a document: unverified",
  image_analysis: "From a photograph: draft only",
  model_draft: "AI draft: unverified",
};

export type EvidenceRef = { type: "intelligence_snapshot" | "job" | "media" | "document_span" | "prior_survey" | "observation"; id: string; label: string; url?: string; date?: string | null };

export type ProposalDraft = {
  fieldPath: string;
  proposedValue: FieldValue;
  valueType: string;
  evidenceRefs: EvidenceRef[];
  originClass: ProposalOrigin;
  limitations: string[];
  baseValueId: string | null;
  inputVersion: string;
  dedupeKey: string;
  generator: string;
  modelVersion: string;
  promptVersion: string;
  knowledgeVersion: string;
};

export type DiscrepancyDraft = { kind: "discrepancy"; dedupeKey: string; fieldPath: string; title: string; detail: string; evidence: Record<string, unknown> };

const transitions: Record<ProposalReviewState, readonly ProposalReviewState[]> = {
  pending: ["accepted", "edited", "rejected", "superseded"],
  accepted: [],
  edited: [],
  rejected: [],
  superseded: [],
};

/** Review is one-way: once decided, a proposal is kept as evaluation evidence and never reopened. */
export function canTransitionProposal(from: ProposalReviewState, to: ProposalReviewState) {
  return transitions[from].includes(to);
}
