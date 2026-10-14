import { describe, expect, it } from "vitest";
import { twoStepSatisfied } from "./two-step-policy";

describe("two-step sign-in policy", () => {
  it("admits everyone when the practice does not require it", () => { expect(twoStepSatisfied(false, null)).toBe(true); expect(twoStepSatisfied(false, [5, -1])).toBe(true); });
  it("requires a session verified with a second factor when the practice does", () => {
    expect(twoStepSatisfied(true, [3, 3])).toBe(true);
    expect(twoStepSatisfied(true, [3, 0])).toBe(true);
    expect(twoStepSatisfied(true, [3, -1])).toBe(false);
    expect(twoStepSatisfied(true, null)).toBe(false);
    expect(twoStepSatisfied(true, undefined)).toBe(false);
  });
});
