import { afterEach, describe, expect, it, vi } from "vitest";
import { epcProvider, locationFingerprint, providerCacheKey, ProviderHttpError, propertyLocationSchema, retryClassification, searchNominatim, searchPostcode, sourceRegistry, validateProviderResult } from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("property intelligence contracts", () => {
  const location = { propertyId: crypto.randomUUID(), country: "ENG" as const, uprn: "123456789", latitude: 51.45, longitude: -2.58, address: "14 Clifton Park, Bristol", propertyVersion: 1 };

  it("validates UK property identity without converting UPRNs to numbers", () => {
    const value = propertyLocationSchema.parse({ propertyId: crypto.randomUUID(), country: "ENG", uprn: "000123456789", latitude: 51.45, longitude: -2.58, address: "14 Clifton Park, Bristol", propertyVersion: 2 });
    expect(value.uprn).toBe("000123456789");
  });

  it("rejects invalid coordinates and UPRNs", () => {
    expect(() => propertyLocationSchema.parse({ propertyId: crypto.randomUUID(), country: "ENG", uprn: "12A", latitude: 100, longitude: -2.58, address: "Test address", propertyVersion: 1 })).toThrow();
  });

  it("changes the fingerprint when identity changes", () => {
    const base = { country: "ENG" as const, uprn: "123", latitude: 51.45, longitude: -2.58, propertyVersion: 1 };
    expect(locationFingerprint(base)).not.toBe(locationFingerprint({ ...base, propertyVersion: 2 }));
  });

  it("builds cache keys from provider, version and the complete property identity", () => {
    const location = { country: "ENG" as const, uprn: "123", latitude: 51.45, longitude: -2.58, propertyVersion: 1 };
    expect(providerCacheKey("planning_data", location, "2026-10")).toBe("property-data:planning_data:2026-10:ENG:123:51.4500000:-2.5800000:1");
    expect(providerCacheKey("planning_data", { ...location, propertyVersion: 2 }, "2026-10")).not.toBe(providerCacheKey("planning_data", location, "2026-10"));
  });

  it("classifies only retryable transport and provider failures as transient", () => {
    expect(retryClassification(new ProviderHttpError(429))).toBe("transient");
    expect(retryClassification(new ProviderHttpError(503))).toBe("transient");
    expect(retryClassification(new ProviderHttpError(401))).toBe("permanent");
    expect(retryClassification(new TypeError("network unavailable"))).toBe("transient");
    expect(retryClassification(new Error("invalid payload"))).toBe("permanent");
  });

  it("validates provider status, confidence, coverage and licence metadata", () => {
    const result = validateProviderResult({ source: "planning_data", category: "planning", status: "no_match", records: [], matchMethod: "point_intersection", confidence: 0.9, coverage: "partial", informationClass: "authoritative_external", licence: "Open Government Licence v3.0", attribution: "Crown copyright", retrievedAt: new Date().toISOString() });
    expect(result.status).toBe("no_match");
    expect(() => validateProviderResult({ ...result, confidence: 1.1 })).toThrow();
    expect(() => validateProviderResult({ ...result, licence: "" })).toThrow();
  });

  it("retries a transient provider response once", async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 200, result: { postcode: "BS8 4JX", admin_district: "Bristol, City of", latitude: 51.46, longitude: -2.62, country: "England" } }), { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    await expect(searchPostcode("BS8 4JX")).resolves.toHaveLength(1);
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps flood zones as distinct sources", () => {
    expect(sourceRegistry.some((source) => source.key === "ea_flood_zone_2")).toBe(true);
    expect(sourceRegistry.some((source) => source.key === "ea_flood_zone_3")).toBe(true);
  });

  it("labels postcode results as approximate centroids", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 200, result: { postcode: "BS8 4JX", admin_district: "Bristol, City of", latitude: 51.46, longitude: -2.62, country: "England" } }), { status: 200 })));
    const [result] = await searchPostcode("BS8 4JX");
    expect(result.precision).toBe("postcode");
    expect(result.providerKey).toBe("postcodes_io");
  });

  it("does not call Nominatim until deployment identification is configured", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    expect(await searchNominatim("14 Clifton Park", {})).toEqual([]);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("filters configured geocoder results to England", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { place_id: 1, display_name: "14 Clifton Park, Bristol", lat: "51.46", lon: "-2.62", address: { house_number: "14", road: "Clifton Park", city: "Bristol", postcode: "BS8 3BY", country_code: "gb", state: "England" } },
      { place_id: 2, display_name: "Cardiff", lat: "51.48", lon: "-3.18", address: { city: "Cardiff", country_code: "gb", state: "Wales" } },
    ]), { status: 200 })));
    const results = await searchNominatim("14 Clifton Park", { baseUrl: "https://example.test/", userAgent: "Surveynt/1.0 (contact: support@example.test)" });
    expect(results).toHaveLength(1);
    expect(results[0].line1).toBe("14 Clifton Park");
  });

  it("keeps EPC disabled until credentials are configured", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const result = await epcProvider({}).fetch(location, new AbortController().signal);
    expect(result.status).toBe("not_configured");
    expect(result.coverage).toBe("unknown");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not imply an EPC absence when a UPRN has not been confirmed", async () => {
    const result = await epcProvider({ email: "developer@example.test", apiKey: "secret" }).fetch({ ...location, uprn: undefined }, new AbortController().signal);
    expect(result.status).toBe("not_configured");
    expect(result.matchMethod).toBe("uprn_required");
    expect(result.coverage).toBe("unknown");
    expect(result.safeError).toMatch(/not checked/i);
  });

  it("normalises configured EPC records by UPRN", async () => {
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [{ "lmk-key": "epc-1", "current-energy-rating": "C", "lodgement-date": "2026-09-01" }] }), { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    const result = await epcProvider({ email: "developer@example.test", apiKey: "secret", baseUrl: "https://example.test/" }).fetch(location, new AbortController().signal);
    expect(result.status).toBe("matched");
    expect(result.matchMethod).toBe("uprn");
    expect(result.records[0]?.sourceRecordId).toBe("epc-1");
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("reports unsupported EPC countries before configuration state", async () => {
    const result = await epcProvider({}).fetch({ ...location, country: "SCT" }, new AbortController().signal);
    expect(result.status).toBe("unsupported");
    expect(result.coverage).toBe("outside_coverage");
  });
});
