import { describe, expect, it } from "vitest";
import { portalProgress, safeAccent } from "./client-portal-model";

describe("client portal progress", () => {
  it("marks done, current and upcoming steps with the first date each was reached", () => {
    const steps = portalProgress("report_drafting", [{ toStage: "instructed", at: "2026-10-01T09:00:00Z" }, { toStage: "inspection_complete", at: "2026-10-05T15:00:00Z" }, { toStage: "report_drafting", at: "2026-10-06T09:00:00Z" }]);
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(steps[1].reachedAt).toBe("2026-10-05T15:00:00.000Z");
    expect(steps[4].reachedAt).toBeNull();
  });
  it("treats pre-instruction stages as not started and archived as complete", () => {
    expect(portalProgress("quoted", []).every((step) => step.state === "upcoming")).toBe(true);
    expect(portalProgress("archived", []).every((step) => step.state === "done")).toBe(true);
  });
  it("accepts only hex accent colours", () => {
    expect(safeAccent("#0F766E")).toBe("#0F766E");
    expect(safeAccent("red; background:url(x)")).toBeNull();
    expect(safeAccent(null)).toBeNull();
  });
});
