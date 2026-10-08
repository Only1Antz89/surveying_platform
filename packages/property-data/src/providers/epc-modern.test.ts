import { describe, expect, it, vi } from "vitest";
import { modernEpcProvider, normaliseDomesticCertificate, paddedEpcUprn } from "./epc-modern";
import type { PropertyLocation } from "../contract";
import type { ProviderContext } from "./types";

const location: PropertyLocation = { propertyId: "property", country: "ENG", uprn: "12345", postcode: "BS8 4JX", latitude: 51.45, longitude: -2.6, locationConfidence: "surveyor_confirmed" };
const env = { EPC_API_TOKEN: "test-only-token", EPC_LICENCE_ACCEPTED: "true", EPC_DATA_PROTECTION_APPROVED: "true" };
const context: ProviderContext = { now: new Date("2026-10-04"), env };
const data = { uprn: 12345, schema_type: "RdSAP-Schema-21.0.1", registration_date: "2025-01-01", current_energy_efficiency_band: "D", dwelling_type: "Mid-terrace house", total_floor_area: 85, walls: [{ description: { value: "Solid brick, no insulation (assumed)" } }], hot_water: { description: { value: "From main system" } }, completion_date: "2025-01-01", address_line_1: "Private address", suggested_improvements: [{ sequence: 1, indicative_cost: "£220–£250", improvement_details: { improvement_number: 66 } }] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("current official EPC adapter", () => {
  it("decodes verified 19.0 and 20.0.0 description shapes without interpreting construction-age codes", () => {
    // Minimal public fixture extracts; source URLs are recorded in the implementation inventory.
    const older = normaliseDomesticCertificate({ schema_type: "RdSAP-Schema-19.0", dwelling_type: { value: "Semi-detached house", language: "1" }, walls: [{ description: { value: "Cavity wall, as built, insulated (assumed)", language: "1" } }], suggested_improvements: [{ sequence: 1, typical_saving: { value: 51, currency: "GBP" }, improvement_details: { improvement_number: 58 } }], sap_building_parts: [{ construction_age_band: "D" }] }, null);
    expect(older).toMatchObject({ schemaSupported: true, propertyType: "Semi-detached house", constructionAgeBand: null, walls: expect.stringContaining("(assumed)") });
    expect(older.recommendations[0]).toMatchObject({ typicalSaving: 51, improvementCode: 58, description: null });
    const newer = normaliseDomesticCertificate({ schema_type: "RdSAP-Schema-20.0.0", walls: [{ description: "Solid brick, as built, no insulation (assumed)" }], suggested_improvements: [{ sequence: 3, indicative_cost: 1000, improvement_details: { improvement_texts: { improvement_summary: "An improvement summary", improvement_description: "An improvement desc" } } }] }, null);
    expect(newer.walls).toContain("(assumed)");
    expect(newer.recommendations[0]).toMatchObject({ description: "An improvement desc", indicativeCostAmount: 1000 });
  });
  it("pads UPRNs without accepting invalid identifiers", () => {
    expect(paddedEpcUprn("12345")).toBe("000000012345");
    expect(paddedEpcUprn(12345)).toBe("000000012345");
    for (const value of [null, "1234567890123", "12e3", "1.5", "-1"]) expect(paddedEpcUprn(value)).toBeNull();
  });
  it("does not enable legacy credentials or unconfirmed locations", () => {
    expect(modernEpcProvider.applicability(location, { ...context, env: { EPC_API_EMAIL: "test@example.test", EPC_API_KEY: "legacy" } })).toMatchObject({ status: "not_configured" });
    expect(modernEpcProvider.applicability({ ...location, locationConfidence: "postcode_centroid" }, context)).toMatchObject({ status: "unsupported" });
    expect(modernEpcProvider.applicability(location, { ...context, env: { ...env, EPC_DATA_PROTECTION_APPROVED: "false" } })).toMatchObject({ status: "not_configured" });
  });
  it("uses bearer search and details, verifies identity and excludes addresses from records and cache", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-only-token");
      if (url.pathname === "/api/domestic/search") {
        expect(url.searchParams.get("uprn")).toBe("000000012345");
        return json({ data: [{ certificateNumber: "certificate", uprn: 12345, registrationDate: "2025-01-01", schemaType: "RdSAP-Schema-21.0.1" }, { certificateNumber: "neighbour", uprn: 12346 }] });
      }
      expect(url.pathname).toBe("/api/certificate");
      expect(url.searchParams.get("certificate_number")).toBe("certificate");
      return json({ data });
    });
    const result = await modernEpcProvider.run(location, { ...context, fetchImpl, cache: { getOrLoad: async (_key, _ttl, load) => { const cached = await load(); expect(JSON.stringify(cached)).not.toContain("Private address"); return cached; } } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result[0].records[0].data).toMatchObject({ walls: "Solid brick, no insulation (assumed)", hotWater: "From main system", constructionAgeBand: null });
    expect(JSON.stringify(result)).not.toContain("completion_date");
  });
  it("fails closed for mismatched certificate identities or invalid response shapes", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => new URL(String(input)).pathname.endsWith("search") ? json({ data: [{ certificateNumber: "certificate", uprn: 12345 }] }) : json({ data: { ...data, uprn: 12346 } }));
    await expect(modernEpcProvider.run(location, { ...context, fetchImpl })).rejects.toMatchObject({ code: "invalid_response" });
    await expect(modernEpcProvider.run(location, { ...context, fetchImpl: async () => json({ rows: [] }) })).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("keeps unsupported and missing fields unavailable rather than inventing descriptions or recommendation text", () => {
    const unsupported = normaliseDomesticCertificate({ ...data, schema_type: "Future-99" }, null);
    expect(unsupported).toMatchObject({ schemaSupported: false, walls: null, heating: null, recommendations: [], propertyType: null });
    expect(normaliseDomesticCertificate(data, null).recommendations[0]).toMatchObject({ improvementCode: 66, description: null });
    expect(normaliseDomesticCertificate({ schema_type: "RdSAP-Schema-21.0.1" }, null)).toMatchObject({ walls: null, currentRating: null, totalFloorAreaM2: null });
  });
});
