import type { ServiceLevel } from "@surveynt/assistant";
/** Recommendation only: the surveyor confirms the agreed scope before capture starts. */
export function suggestedServiceScope(name: string): ServiceLevel | null {
  if (/\blevel\s*1\b/i.test(name)) return "level_1";
  if (/\blevel\s*2\b/i.test(name)) return "level_2";
  if (/\blevel\s*3\b/i.test(name)) return "level_3";
  return null;
}
