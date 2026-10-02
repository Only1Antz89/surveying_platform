import { describe, expect, it } from "vitest";
import { runEvaluation } from "../eval/cases";

describe("evaluation pack", () => {
  it("passes every synthetic case, abstains where labelled and makes no unsupported claims", async () => {
    const summary = await runEvaluation();
    expect(summary.results.filter((result) => !result.passed).map((result) => `${result.id}: ${result.observed}`)).toEqual([]);
    expect(summary).toMatchObject({ unsupportedClaims: 0 });
    expect(summary.correctAbstentions).toBe(summary.abstentionCases);
    expect(summary.total).toBeGreaterThanOrEqual(10);
  }, 30_000);
});
