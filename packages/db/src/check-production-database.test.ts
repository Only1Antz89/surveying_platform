import { describe, expect, it } from "vitest";
import { compareLedger, expectedMigrations } from "../scripts/check-production-database";

describe("production migration ledger check", () => {
  it("hashes every journal entry from the committed SQL", async () => {
    const expected = await expectedMigrations();
    expect(expected.length).toBeGreaterThan(80);
    expect(new Set(expected.map((entry) => entry.hash)).size).toBe(expected.length);
    expect(expected.every((entry) => /^[0-9a-f]{64}$/.test(entry.hash))).toBe(true);
  });

  it("names the migrations a database has not applied yet", () => {
    const expected = [{ tag: "0081_a", when: 1, hash: "a" }, { tag: "0082_b", when: 2, hash: "b" }, { tag: "0083_c", when: 3, hash: "c" }];
    const result = compareLedger(expected, [{ hash: "a", created_at: "1" }]);
    expect(result).toMatchObject({ lastApplied: "0081_a", missing: ["0082_b", "0083_c"], timestampMismatch: [], unknownApplied: 0 });
  });

  it("flags edited history and rows the repository does not know", () => {
    const expected = [{ tag: "0001_a", when: 1, hash: "a" }];
    expect(compareLedger(expected, [{ hash: "a", created_at: 5 }, { hash: "zzz", created_at: 9 }])).toMatchObject({ missing: [], timestampMismatch: ["0001_a"], unknownApplied: 1 });
  });
});
