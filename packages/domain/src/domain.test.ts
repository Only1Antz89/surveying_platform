import { describe, expect, it } from "vitest";
import { canTransitionJob, resolveAccess } from "./index";

describe("job transitions", () => {
  it("allows the normal instructed to scheduled transition", () => {
    expect(canTransitionJob("instructed", "scheduled")).toBe(true);
  });

  it("prevents bypassing professional review", () => {
    expect(canTransitionJob("report_drafting", "issued")).toBe(false);
  });
});

describe("access policy", () => {
  it("lets an active firm work", () => {
    expect(resolveAccess("active", "active")).toBe("full");
  });

  it("lets a platform suspension override healthy billing", () => {
    expect(resolveAccess("suspended", "active")).toBe("blocked");
  });

  it("reduces expired past-due accounts to read only", () => {
    expect(resolveAccess("active", "past_due", new Date("2026-01-01"), new Date("2026-01-08"))).toBe("read_only");
  });
});
