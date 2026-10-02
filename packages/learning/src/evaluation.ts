import { createHash } from "node:crypto";

// Pipeline step 8 (L3). Evaluation splits keep every case from one property on
// the same side, hold out whole contributors, and can reserve later cases as a
// test set. Training is not implemented; these splits measure retrieval.

export type SplitItem = { candidateId: string; contributorKey: string; groupKey: string; reviewedAt: string };
export type SplitOptions = { heldOutContributors: string[]; testFromDate: string | null; testShare: number; seed: string };
export type SplitAssignment = { candidateId: string; split: "train" | "test"; reason: "held_out_contributor" | "later_date" | "sampled" | "train" };

const unitHash = (value: string) => parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) / 0xffffffff;

export function planEvaluationSplits(items: SplitItem[], options: SplitOptions): SplitAssignment[] {
  const groups = new Map<string, SplitItem[]>();
  for (const item of items) groups.set(item.groupKey, [...(groups.get(item.groupKey) ?? []), item]);
  const held = new Set(options.heldOutContributors);
  const assignments: SplitAssignment[] = [];
  for (const [groupKey, members] of groups) {
    const reason: SplitAssignment["reason"] = members.some((item) => held.has(item.contributorKey)) ? "held_out_contributor"
      : options.testFromDate && members.some((item) => item.reviewedAt >= options.testFromDate!) ? "later_date"
        : unitHash(`${options.seed}:${groupKey}`) < options.testShare ? "sampled" : "train";
    for (const item of members) assignments.push({ candidateId: item.candidateId, split: reason === "train" ? "train" : "test", reason });
  }
  // A contributor held out must not appear in training through another property.
  const testContributors = new Set(items.filter((item) => held.has(item.contributorKey)).map((item) => item.contributorKey));
  return assignments.map((assignment) => {
    const item = items.find((candidate) => candidate.candidateId === assignment.candidateId)!;
    return testContributors.has(item.contributorKey) ? { ...assignment, split: "test", reason: "held_out_contributor" } : assignment;
  });
}

/** Property groups or held-out contributors found on both sides of a split. Must be empty. */
export function splitLeakage(items: SplitItem[], assignments: SplitAssignment[], heldOutContributors: string[] = []) {
  const split = new Map(assignments.map((item) => [item.candidateId, item.split]));
  const sides = new Map<string, Set<string>>();
  for (const item of items) sides.set(item.groupKey, (sides.get(item.groupKey) ?? new Set()).add(split.get(item.candidateId) ?? "missing"));
  const groups = [...sides].filter(([, values]) => values.size > 1).map(([key]) => key);
  const contributors = heldOutContributors.filter((key) => items.some((item) => item.contributorKey === key && split.get(item.candidateId) === "train"));
  return { groups, contributors };
}

/** Firm-size segments for reporting results separately; thresholds are set by reviewers. */
export function contributorSegments(counts: Map<string, number>, thresholds: { small: number; large: number }) {
  return new Map([...counts].map(([key, count]) => [key, count < thresholds.small ? "small" : count >= thresholds.large ? "large" : "medium"] as const));
}
