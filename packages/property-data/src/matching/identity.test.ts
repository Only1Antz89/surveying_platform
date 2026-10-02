import { describe, expect, it } from "vitest";
import { addressFingerprint, assessUprnCandidates, countryFromPostcode, distanceMetres, isValidUprn, isWithinUkBounds, locationFingerprint, looksLikePostcode, normalisePostcode, uprnConfirmationProblem } from "./identity";

describe("postcodes", () => {
  it("normalises valid UK postcodes and rejects other shapes", () => {
    expect(normalisePostcode("bs84jx")).toBe("BS8 4JX");
    expect(normalisePostcode(" SW1A 1AA ")).toBe("SW1A 1AA");
    expect(normalisePostcode("12345")).toBeNull();
    expect(looksLikePostcode("18 Royal York Crescent")).toBe(false);
    expect(countryFromPostcode("BT1 1AA")).toBe("NIR");
    expect(countryFromPostcode("CH1 1AA")).toBeNull();
  });
});

describe("coordinates and identifiers", () => {
  it("validates UK bounds and UPRN format", () => {
    expect(isWithinUkBounds(51.4545, -2.5879)).toBe(true);
    expect(isWithinUkBounds(48.85, 2.35)).toBe(false);
    expect(isWithinUkBounds(Number.NaN, 0)).toBe(false);
    expect(isValidUprn("100023336956")).toBe(true);
    expect(isValidUprn("0")).toBe(false);
    expect(isValidUprn("1234567890123")).toBe(false);
    expect(isValidUprn("12a")).toBe(false);
  });

  it("computes metre distances", () => {
    // About 111 m per 0.001 degree of latitude.
    expect(distanceMetres({ latitude: 51.0, longitude: -2.0 }, { latitude: 51.001, longitude: -2.0 })).toBeCloseTo(111.2, 0);
  });
});

describe("UPRN candidate assessment", () => {
  const origin = { latitude: 51.4545, longitude: -2.6201 };

  it("never auto-selects, even with exactly one candidate at the point", () => {
    const result = assessUprnCandidates({ candidates: [{ uprn: "1", ...origin, distanceMetres: 0 }], originConfidence: "geocoded_address", country: "ENG", referenceAvailable: true });
    expect(result.autoSelectable).toBe(false);
  });

  it("flags postcode-centroid origins as approximate", () => {
    const result = assessUprnCandidates({ candidates: [{ uprn: "1", ...origin, distanceMetres: 12 }], originConfidence: "postcode_centroid", country: "ENG", referenceAvailable: true });
    expect(result.warnings).toContain("origin_is_postcode_centroid");
    expect(result.searchRadiusMetres).toBe(250);
  });

  it("keeps co-located flats ambiguous instead of choosing one", () => {
    const flats = ["10", "11", "12"].map((uprn) => ({ uprn, ...origin, distanceMetres: 3 }));
    const result = assessUprnCandidates({ candidates: flats, originConfidence: "surveyor_confirmed", country: "ENG", referenceAvailable: true });
    expect(result.warnings).toContain("multiple_at_same_point");
    expect(result.candidates.every((candidate) => candidate.colocated === 3)).toBe(true);
  });

  it("does not search GB-only data for Northern Ireland or when no reference data exists", () => {
    expect(assessUprnCandidates({ candidates: [], originConfidence: "geocoded_address", country: "NIR", referenceAvailable: true }).warnings).toEqual(["coverage_not_gb"]);
    expect(assessUprnCandidates({ candidates: [], originConfidence: "geocoded_address", country: "ENG", referenceAvailable: false }).warnings).toEqual(["reference_not_imported"]);
  });

  it("requires an explanation for other evidence", () => {
    expect(uprnConfirmationProblem({ evidenceType: "other", note: " " })).not.toBeNull();
    expect(uprnConfirmationProblem({ evidenceType: "title_documents" })).toBeNull();
  });
});

describe("fingerprints", () => {
  it("changes when coordinates or UPRN change but not for equivalent address formatting", async () => {
    const base = { country: "ENG" as const, uprn: null, latitude: 51.4545, longitude: -2.6201, locationConfidence: "geocoded_address" as const };
    expect(await locationFingerprint(base)).not.toBe(await locationFingerprint({ ...base, latitude: 51.4546 }));
    expect(await locationFingerprint(base)).not.toBe(await locationFingerprint({ ...base, uprn: "1" }));
    expect(await addressFingerprint({ line1: "18 Royal York  Crescent", city: "bristol", postcode: "bs84jx" })).toBe(await addressFingerprint({ line1: "18 ROYAL YORK CRESCENT", city: "Bristol", postcode: "BS8 4JX" }));
  });
});
