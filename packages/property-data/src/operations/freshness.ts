import type { SourceDefinition } from "../registry/sources";

export type FreshnessState = "current" | "release_check_due" | "not_imported" | "live_api" | "blocked";

export type FreshnessInput = {
  /** Activation times of the active versions, one per layer. */
  activeActivatedAt: Date[];
  lastReleaseCheckAt: Date | null;
  now: Date;
};

/**
 * Freshness of a source from its refresh policy. Bulk datasets are due for a
 * release check when neither an activation nor a recorded check falls within
 * the policy window. Live APIs are fresh per request and report "live_api".
 */
export function sourceFreshness(definition: Pick<SourceDefinition, "accessMethod" | "registerStatus" | "refreshPolicy">, input: FreshnessInput): { state: FreshnessState; dueAt: string | null; basis: string } {
  if (definition.registerStatus === "blocked") return { state: "blocked", dueAt: null, basis: "Blocked in the source register." };
  if (definition.accessMethod !== "bulk_import") return { state: "live_api", dueAt: null, basis: `Queried on demand; responses are cached for up to ${definition.refreshPolicy.days} days.` };
  if (!input.activeActivatedAt.length) return { state: "not_imported", dueAt: null, basis: "No active version has been imported." };
  const oldestActivation = Math.min(...input.activeActivatedAt.map((date) => date.getTime()));
  const lastChecked = Math.max(oldestActivation, input.lastReleaseCheckAt?.getTime() ?? 0);
  const due = lastChecked + definition.refreshPolicy.days * 86_400_000;
  return due <= input.now.getTime()
    ? { state: "release_check_due", dueAt: new Date(due).toISOString(), basis: `No import or release check in the last ${definition.refreshPolicy.days} days.` }
    : { state: "current", dueAt: new Date(due).toISOString(), basis: `Next release check due within ${definition.refreshPolicy.days} days of the last import or check.` };
}
