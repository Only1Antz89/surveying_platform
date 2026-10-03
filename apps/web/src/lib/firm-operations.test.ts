import { describe, expect, it } from "vitest";
import { calculateQuoteMoney, recommendCliftonService } from "./firm-operations";

describe("firm operations pricing", () => {
  it("uses integer minor units for Clifton VAT, surcharges and deposit", () => {
    expect(calculateQuoteMoney(45_000, 2_000, 1_000, [{ amountMinor: 8_000 }])).toEqual({ surchargeMinor: 8_000, subtotalMinor: 53_000, vatMinor: 10_600, totalMinor: 63_600, depositMinor: 6_360 });
  });
  it("rounds VAT and deposits once at their defined boundaries", () => {
    expect(calculateQuoteMoney(33_333, 2_000, 1_000, [])).toEqual({ surchargeMinor: 0, subtotalMinor: 33_333, vatMinor: 6_667, totalMinor: 40_000, depositMinor: 4_000 });
  });
  it("recommends detailed inspection for old, altered or structurally concerning property", () => {
    expect(recommendCliftonService({ propertyAge: "pre-1950", concerns: "cracks" }).match).toBe("RICS Level 3 Survey");
    expect(recommendCliftonService({ propertyAge: "1950-1989", extensions: true }).match).toBe("RICS Level 3 Survey");
  });
  it("keeps formal valuation and targeted roof requests distinct", () => {
    expect(recommendCliftonService({ purpose: "formal-valuation" }).match).toBe("Valuation Report");
    expect(recommendCliftonService({ purpose: "roof-only" }).match).toBe("Drone Survey");
  });
});
