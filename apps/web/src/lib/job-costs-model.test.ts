import { describe, expect, it } from "vitest";
import { costEntryInput, costSummary, feeToMinor, hoursLabel } from "./job-costs-model";

describe("job costs", () => {
  it("costs time, mileage and expenses against the fee", () => {
    const summary = costSummary([{ kind: "time", minutes: 420, miles: null, amountMinor: null }, { kind: "mileage", minutes: null, miles: 18.4, amountMinor: null }, { kind: "expense", minutes: null, miles: null, amountMinor: 850 }], { staffCostRatePence: 3500, mileageRatePence: 45 }, feeToMinor("1450.00"));
    expect(summary).toMatchObject({ minutes: 420, miles: 18.4, timeCostMinor: 24500, mileageCostMinor: 828, expensesMinor: 850, totalCostMinor: 26178, feeMinor: 145000, profitMinor: 118822, marginPercent: 81.9 });
  });
  it("leaves profit unknown without a fee and shows losses as negative margins", () => {
    expect(costSummary([{ kind: "time", minutes: 60, miles: null, amountMinor: null }], { staffCostRatePence: 3500, mileageRatePence: 45 }, null)).toMatchObject({ profitMinor: null, marginPercent: null });
    expect(costSummary([{ kind: "expense", minutes: null, miles: null, amountMinor: 20000 }], { staffCostRatePence: 0, mileageRatePence: 0 }, 10000).marginPercent).toBe(-100);
  });
  it("validates entries by kind and rejects future or ancient dates", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(costEntryInput.safeParse({ kind: "time", occurredOn: today, minutes: 90 }).success).toBe(true);
    expect(costEntryInput.safeParse({ kind: "time", occurredOn: today, minutes: 0 }).success).toBe(false);
    expect(costEntryInput.safeParse({ kind: "expense", occurredOn: today, amountMinor: 500 }).success).toBe(false);
    expect(costEntryInput.safeParse({ kind: "mileage", occurredOn: "2030-01-01", miles: 3 }).success).toBe(false);
    expect(hoursLabel(125)).toBe("2h 05m");
  });
});
