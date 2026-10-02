import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { createDatabase, sharedCases, sharedReleases } from "@surveynt/db";
import { assistantEnabled } from "./assistant-flags";
import { loadProgramme } from "./learning";

export const sharedCaseNotice = "Reviewed, generalised examples from other surveys. They support a prompt or a draft; they do not show that the same defect exists at this property.";

/**
 * Shared retrieval (L2). Every assistant-enabled firm sees the same active
 * release, whether or not it contributes. Results carry a knowledge reference,
 * never contributor or customer identity.
 */
export async function searchSharedCases(input: { elementKey?: string | null; jurisdiction?: string | null; query?: string | null; limit?: number }) {
  const db = createDatabase();
  const programme = await loadProgramme(db);
  if (!programme.status.active) return { available: false as const, reason: "Shared learning is not active on Surveynt.", release: null, cases: [], notice: sharedCaseNotice };
  if (!assistantEnabled()) return { available: false as const, reason: "The assistant is switched off for this deployment.", release: null, cases: [], notice: sharedCaseNotice };
  const [release] = await db.select({ id: sharedReleases.id, version: sharedReleases.version, activatedAt: sharedReleases.activatedAt, coverage: sharedReleases.coverage }).from(sharedReleases).where(eq(sharedReleases.status, "active")).limit(1);
  if (!release) return { available: true as const, reason: "No shared release is active yet.", release: null, cases: [], notice: sharedCaseNotice };
  const query = input.query?.trim().slice(0, 200) || null;
  const conditions: SQL[] = [eq(sharedCases.releaseId, release.id)];
  if (input.elementKey) conditions.push(eq(sharedCases.elementKey, input.elementKey));
  if (input.jurisdiction) conditions.push(eq(sharedCases.jurisdiction, input.jurisdiction));
  if (query) conditions.push(sql`${sharedCases.search} @@ websearch_to_tsquery('english', ${query})`);
  const rows = await db.select({
    id: sharedCases.id, jurisdiction: sharedCases.jurisdiction, serviceLevel: sharedCases.serviceLevel, propertyType: sharedCases.propertyType, builtForm: sharedCases.builtForm, ageBand: sharedCases.ageBand,
    elementKey: sharedCases.elementKey, elementLabel: sharedCases.elementLabel, observedFeature: sharedCases.observedFeature, possibleCauses: sharedCases.possibleCauses, confirmedCause: sharedCases.confirmedCause,
    confirmationBasis: sharedCases.confirmationBasis, surveyorJudgement: sharedCases.surveyorJudgement, ratingExample: sharedCases.ratingExample, nextSteps: sharedCases.nextSteps, limitations: sharedCases.limitations,
    uncertainty: sharedCases.uncertainty, evidenceStrength: sharedCases.evidenceStrength, ratingDisagreement: sharedCases.ratingDisagreement, noDefect: sharedCases.noDefect,
  }).from(sharedCases).where(and(...conditions))
    .orderBy(query ? sql`ts_rank(${sharedCases.search}, websearch_to_tsquery('english', ${query})) desc` : desc(sharedCases.weight), sharedCases.id)
    .limit(Math.max(1, Math.min(input.limit ?? 10, 25)));
  return {
    available: true as const, reason: null, notice: sharedCaseNotice,
    release: { version: release.version, activatedAt: release.activatedAt?.toISOString() ?? null, unsupportedSegments: (release.coverage as { unsupportedSegments?: string[] }).unsupportedSegments ?? [] },
    cases: rows.map((row) => ({ ...row, reference: `Shared case ${row.id.slice(0, 8)} · release ${release.version}` })),
  };
}
