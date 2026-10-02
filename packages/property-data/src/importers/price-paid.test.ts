import { describe, expect, it } from "vitest";
import { parseCsvLine } from "./csv";
import { normaliseTransactionId, normaliseUprn, parsePostcodeAreas, parsePricePaidLine, postcodeAreasFromExtent } from "./price-paid";

// Synthetic rows in the published 16-column layout. The address values are invented.
const ppd = (overrides: Partial<Record<number, string>> = {}) => {
  const fields = ["{8A1B2C3D-0000-4000-8000-000000000001}", "425000", "2019-03-12 00:00", "BS8 4JX", "T", "N", "F", "12", "FLAT 2", "TEST TERRACE", "", "BRISTOL", "CITY OF BRISTOL", "CITY OF BRISTOL", "A", "A"];
  for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value!;
  return fields.map((field) => `"${field.replace(/"/g, '""')}"`).join(",");
};

describe("CSV and identifier parsing", () => {
  it("parses quoted fields, embedded commas and doubled quotes", () => {
    expect(parseCsvLine('"a","b, c","say ""hi""",,plain')).toEqual(["a", "b, c", 'say "hi"', "", "plain"]);
    expect(parseCsvLine('"unterminated,1')).toBeNull();
  });

  it("normalises transaction ids and UPRNs", () => {
    expect(normaliseTransactionId("{8a1b2c3d-0000-4000-8000-000000000001}")).toBe("8A1B2C3D-0000-4000-8000-000000000001");
    expect(normaliseTransactionId("not-an-id")).toBeNull();
    expect(normaliseUprn(" 000123 ")).toBe("123");
    expect(normaliseUprn("12a")).toBeNull();
    expect(normaliseUprn("1234567890123")).toBeNull();
  });

  it("validates postcode areas and reads them back from the sync extent", () => {
    expect(parsePostcodeAreas("ba, bs,BS")).toEqual(["BA", "BS"]);
    expect(() => parsePostcodeAreas("BS8")).toThrow();
    expect(postcodeAreasFromExtent("postcode areas: BA,BS")).toEqual(["BA", "BS"]);
    expect(postcodeAreasFromExtent("full file")).toBeNull();
  });
});

describe("Price Paid rows", () => {
  it("keeps only sale fields and the postcode area for filtering", () => {
    const parsed = parsePricePaidLine(ppd());
    expect(parsed).toEqual({ ok: true, recordStatus: "A", postcodeArea: "BS", row: { transactionId: "8A1B2C3D-0000-4000-8000-000000000001", price: 425000, transferDate: "2019-03-12", propertyType: "T", newBuild: false, tenure: "F", ppdCategory: "A" } });
    expect(JSON.stringify(parsed)).not.toMatch(/TEST TERRACE|FLAT 2|BRISTOL/);
  });

  it("accepts changes and deletions, and deletions need only the id", () => {
    expect(parsePricePaidLine(ppd({ 15: "C", 1: "430000" }))).toMatchObject({ ok: true, recordStatus: "C", row: { price: 430000 } });
    expect(parsePricePaidLine(ppd({ 15: "D", 1: "", 4: "" }))).toMatchObject({ ok: true, recordStatus: "D", row: null, transactionId: "8A1B2C3D-0000-4000-8000-000000000001" });
  });

  it("rejects malformed rows without quoting their content", () => {
    for (const line of [ppd({ 1: "-5" }), ppd({ 2: "2019-13-45" }), ppd({ 4: "X" }), ppd({ 0: "123" }), ppd({ 15: "Z" }), '"a","b"']) {
      const parsed = parsePricePaidLine(line);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).not.toMatch(/TERRACE|BRISTOL|BS8/);
    }
  });
});
