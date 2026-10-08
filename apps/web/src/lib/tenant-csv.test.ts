import { describe, expect, it } from "vitest";
import { csvCell } from "./tenant-csv";
describe("financial CSV cells", () => {
  it("escapes quotes and protects text formula prefixes", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    for (const text of ["=1+1", "+SUM(A1)", "-cmd", "@formula", "\t=SUM(A1)"]) expect(csvCell(text)).toBe('"\'' + text + '"');
  });
  it("preserves numeric values, dates and missing values", () => {
    expect(csvCell(-123)).toBe('"-123"');
    expect(csvCell(new Date("2026-10-06T00:00:00Z"))).toBe('"2026-10-06T00:00:00.000Z"');
    expect(csvCell(null)).toBe('""');
  });
});
