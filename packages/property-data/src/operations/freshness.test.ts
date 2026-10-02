import { describe, expect, it } from "vitest";
import { sourceFreshness } from "./freshness";

const bulk = { accessMethod: "bulk_import" as const, registerStatus: "pending" as const, refreshPolicy: { kind: "release_check" as const, days: 30 } };
const now = new Date("2026-10-02T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("source freshness", () => {
  it("separates blocked, live and unimported sources", () => {
    expect(sourceFreshness({ ...bulk, registerStatus: "blocked" }, { activeActivatedAt: [daysAgo(1)], lastReleaseCheckAt: null, now }).state).toBe("blocked");
    expect(sourceFreshness({ ...bulk, accessMethod: "api" }, { activeActivatedAt: [], lastReleaseCheckAt: null, now }).state).toBe("live_api");
    expect(sourceFreshness(bulk, { activeActivatedAt: [], lastReleaseCheckAt: null, now }).state).toBe("not_imported");
  });

  it("is due when neither the oldest active layer nor a release check is within the window", () => {
    expect(sourceFreshness(bulk, { activeActivatedAt: [daysAgo(10)], lastReleaseCheckAt: null, now }).state).toBe("current");
    expect(sourceFreshness(bulk, { activeActivatedAt: [daysAgo(10), daysAgo(40)], lastReleaseCheckAt: null, now }).state).toBe("release_check_due");
    expect(sourceFreshness(bulk, { activeActivatedAt: [daysAgo(40)], lastReleaseCheckAt: daysAgo(5), now }).state).toBe("current");
  });
});
