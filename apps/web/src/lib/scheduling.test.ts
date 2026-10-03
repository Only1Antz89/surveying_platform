import { describe, expect, it } from "vitest";
import { localParts } from "./scheduling";

describe("appointment timezone boundaries", () => {
  it("uses Europe/London civil time before and after daylight-saving transitions", () => {
    expect(localParts(new Date("2026-03-29T08:00:00Z"), "Europe/London")).toMatchObject({ date: "2026-03-29", minutes: 540 });
    expect(localParts(new Date("2026-10-25T09:00:00Z"), "Europe/London")).toMatchObject({ date: "2026-10-25", minutes: 540 });
  });
  it("keeps local holiday dates independent from UTC date boundaries", () => {
    expect(localParts(new Date("2026-07-01T23:30:00Z"), "Europe/London").date).toBe("2026-07-02");
  });
});
