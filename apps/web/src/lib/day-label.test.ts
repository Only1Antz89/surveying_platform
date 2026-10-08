import { describe, expect, it } from "vitest";
import { londonDayLabel } from "./day-label";

describe("londonDayLabel", () => {
  it("formats the Europe/London calendar day without locale-data differences", () => {
    expect(londonDayLabel("2026-10-05T12:00:00Z")).toBe("Mon 5 Oct");
    expect(londonDayLabel("2026-10-08T12:00:00Z", "long")).toBe("Thursday 8 October");
  });
  it("uses the London date across midnight and daylight-saving boundaries", () => {
    expect(londonDayLabel("2026-06-30T23:30:00Z")).toBe("Wed 1 Jul");
    expect(londonDayLabel("2026-12-31T23:30:00Z")).toBe("Thu 31 Dec");
    expect(londonDayLabel("2026-03-29T00:30:00Z", "long")).toBe("Sunday 29 March");
  });
});
