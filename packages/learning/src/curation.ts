import type { ReleaseCriteria } from "./policy";

// Pipeline steps 6 and 7: curation and release checks. Duplicates of the same
// property and element are removed; dominant contributors are down-weighted so
// no firm determines the corpus; coverage gaps are reported, not hidden.

export type CoverageDimension = ReleaseCriteria["coverageDimensions"][number];

export type CurationItem = {
  candidateId: string;
  /** Pseudonymous contributor key (never the organisation id). */
  contributorKey: string;
  /** Same property and element: only one case is released. */
  dedupKey: string;
  /** Same property: kept on one side of any train/test split. */
  groupKey: string;
  reviewedAt: string;
  coverage: Partial<Record<CoverageDimension, string | null>>;
  uncertainty: "low" | "medium" | "high";
  ratingDisagreement: boolean;
  noDefect: boolean;
};

export type CurationResult = {
  included: { candidateId: string; weight: number }[];
  excluded: { candidateId: string; reason: "duplicate" }[];
  manifest: {
    caseCount: number;
    contributorCount: number;
    maxRawShare: number;
    maxEffectiveShare: number;
    capFeasible: boolean;
    coverage: Record<string, Record<string, number>>;
    unsupportedSegments: string[];
    noDefectCases: number;
    disagreementCases: number;
    highUncertaintyCases: number;
    duplicatesRemoved: number;
  };
};

/**
 * Weights capped contributors so their effective share is at most `cap`.
 * Returns null weights when the cap cannot be met with this many contributors.
 */
export function contributorWeights(counts: Map<string, number>, cap: number) {
  if (counts.size === 0) return new Map<string, number>();
  // With n contributors no weighting can push everyone below 1/n.
  if (counts.size * cap < 1 - 1e-9) return null;
  const capped = new Set<string>();
  for (;;) {
    const open = [...counts].filter(([key]) => !capped.has(key));
    if (!open.length || cap * capped.size >= 1 - 1e-9) {
      // Everyone is capped: equal effective mass for every contributor.
      const smallest = Math.min(...counts.values());
      return new Map([...counts].map(([key, count]) => [key, smallest / count]));
    }
    const mass = (cap * open.reduce((sum, [, count]) => sum + count, 0)) / (1 - cap * capped.size);
    const over = open.filter(([, count]) => count > mass + 1e-9);
    if (!over.length) return new Map([...counts].map(([key, count]) => [key, capped.has(key) ? mass / count : 1]));
    for (const [key] of over) capped.add(key);
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function curateRelease(items: CurationItem[], criteria: Pick<ReleaseCriteria, "maxContributorShare" | "coverageDimensions">, expectedSegments: Partial<Record<CoverageDimension, string[]>> = {}): CurationResult {
  const kept = new Map<string, CurationItem>();
  const excluded: CurationResult["excluded"] = [];
  // Most recently reviewed case wins for each property and element.
  for (const item of [...items].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || a.candidateId.localeCompare(b.candidateId))) {
    if (kept.has(item.dedupKey)) excluded.push({ candidateId: item.candidateId, reason: "duplicate" });
    else kept.set(item.dedupKey, item);
  }
  const unique = [...kept.values()].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const counts = new Map<string, number>();
  for (const item of unique) counts.set(item.contributorKey, (counts.get(item.contributorKey) ?? 0) + 1);
  const weights = contributorWeights(counts, criteria.maxContributorShare);
  const total = unique.length;
  const effectiveTotal = weights ? [...counts].reduce((sum, [key, count]) => sum + count * weights.get(key)!, 0) : total;
  const shares = [...counts].map(([key, count]) => ({ raw: total ? count / total : 0, effective: effectiveTotal ? (count * (weights?.get(key) ?? 1)) / effectiveTotal : 0 }));
  const coverage: Record<string, Record<string, number>> = {};
  for (const dimension of criteria.coverageDimensions) {
    coverage[dimension] = {};
    for (const item of unique) {
      const value = item.coverage[dimension] ?? "unknown";
      coverage[dimension][value] = (coverage[dimension][value] ?? 0) + 1;
    }
  }
  const unsupportedSegments = Object.entries(expectedSegments).flatMap(([dimension, values]) => (values ?? []).filter((value) => !coverage[dimension]?.[value]).map((value) => `${dimension}=${value}`));
  return {
    included: unique.map((item) => ({ candidateId: item.candidateId, weight: round(weights?.get(item.contributorKey) ?? 1) })),
    excluded,
    manifest: {
      caseCount: total,
      contributorCount: counts.size,
      maxRawShare: round(Math.max(0, ...shares.map((share) => share.raw))),
      maxEffectiveShare: round(Math.max(0, ...shares.map((share) => share.effective))),
      capFeasible: weights !== null,
      coverage,
      unsupportedSegments,
      noDefectCases: unique.filter((item) => item.noDefect).length,
      disagreementCases: unique.filter((item) => item.ratingDisagreement).length,
      highUncertaintyCases: unique.filter((item) => item.uncertainty === "high").length,
      duplicatesRemoved: excluded.length,
    },
  };
}

export type ReleaseItemState = { candidateId: string; privacyApproved: boolean; technicalApproved: boolean; rightsCurrent: boolean; withdrawn: boolean };

/** Everything that blocks approving a release. An empty list is required, not sufficient: people still decide. */
export function releaseProblems(result: CurationResult, criteria: ReleaseCriteria, items: ReleaseItemState[], quality: { technicalAgreement: number | null }) {
  const problems: string[] = [];
  const byId = new Map(items.map((item) => [item.candidateId, item]));
  if (result.manifest.caseCount < criteria.minimumCasesPerRelease) problems.push(`The release has ${result.manifest.caseCount} cases; the criteria require at least ${criteria.minimumCasesPerRelease}.`);
  if (!result.manifest.capFeasible) problems.push(`Too few contributors to keep any one below ${Math.round(criteria.maxContributorShare * 100)}% of the corpus.`);
  else if (result.manifest.maxEffectiveShare > criteria.maxContributorShare + 1e-6) problems.push("A contributor exceeds the maximum share after weighting.");
  for (const { candidateId } of result.included) {
    const item = byId.get(candidateId);
    if (!item) { problems.push(`Case ${candidateId.slice(0, 8)} has no review record.`); continue; }
    if (item.withdrawn) problems.push(`Case ${candidateId.slice(0, 8)} has been withdrawn.`);
    if (!item.rightsCurrent) problems.push(`Case ${candidateId.slice(0, 8)} no longer has a current contribution grant.`);
    if (!item.privacyApproved) problems.push(`Case ${candidateId.slice(0, 8)} lacks privacy approval.`);
    if (!item.technicalApproved) problems.push(`Case ${candidateId.slice(0, 8)} lacks technical approval.`);
  }
  if (criteria.minimumTechnicalAgreement !== null) {
    if (quality.technicalAgreement === null) problems.push("Technical agreement has not been measured for this release.");
    else if (quality.technicalAgreement < criteria.minimumTechnicalAgreement) problems.push(`Technical agreement ${quality.technicalAgreement} is below the required ${criteria.minimumTechnicalAgreement}.`);
  }
  return problems;
}
