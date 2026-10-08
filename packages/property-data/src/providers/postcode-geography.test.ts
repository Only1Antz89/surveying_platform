import { describe, expect, it } from "vitest";
import { postcodeGeographyProvider } from "./postcode-geography";
import type { PropertyLocation } from "../contract";

const location: PropertyLocation = { propertyId: "property", country: "ENG", postcode: "BS8 4JX", uprn: null, latitude: null, longitude: null, locationConfidence: "unresolved" };
const context = { now: new Date("2026-10-05"), env: {} };

describe("postcode administrative evidence", () => {
  it("requires an England postcode, not a confirmed property location", () => {
    expect(postcodeGeographyProvider.applicability(location, context)).toEqual({ ok: true });
    expect(postcodeGeographyProvider.applicability({ ...location, country: "WLS" }, context)).toMatchObject({ status: "unsupported" });
    expect(postcodeGeographyProvider.applicability({ ...location, postcode: "" }, context)).toMatchObject({ status: "unsupported" });
  });
  it("retains administrative provenance without storing a postcode centroid as property coordinates", async () => {
    const results = await postcodeGeographyProvider.run(location, { ...context, fetchImpl: async () => new Response(JSON.stringify({ status: 200, result: { postcode: "BS8 4JX", latitude: 51.45, longitude: -2.6, country: "England", admin_district: "Bristol", admin_ward: "Clifton", region: "South West", quality: 1, codes: { admin_district: "E06000023" } } })) });
    expect(results[0]).toMatchObject({ status: "matched", coverage: "partial" });
    expect(results[0].records[0]).toMatchObject({ confidence: "low", matchMethod: "postcode", data: { adminDistrict: "Bristol", adminWard: "Clifton" } });
    expect(results[0].records[0].data).not.toHaveProperty("latitude");
    expect(results[0].message).toContain("not a property-specific");
  });
  it("does not translate a missing postcode into a location description", async () => {
    const results = await postcodeGeographyProvider.run(location, { ...context, fetchImpl: async () => new Response("{}", { status: 404 }) });
    expect(results[0]).toMatchObject({ status: "no_match", records: [] });
  });
});
