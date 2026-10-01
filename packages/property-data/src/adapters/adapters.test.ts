import { describe, expect, it, vi } from "vitest";
import { lookupPostcode } from "./postcodes-io";
import { searchAddress, type RateGate } from "./nominatim";

// Fixtures follow the published response shapes of each API. Values are
// illustrative test data, not live records.
const postcodeFixture = {
  status: 200,
  result: {
    postcode: "BS8 4JX", quality: 1, eastings: 357063, northings: 172937, country: "England", nhs_ha: "South West",
    longitude: -2.620131, latitude: 51.454528, region: "South West", admin_district: "Bristol, City of", admin_ward: "Clifton",
    admin_county: null, codes: { admin_district: "E06000023", admin_ward: "E05010891" },
  },
};

const nominatimFixture = [
  {
    place_id: 1001, licence: "Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright", osm_type: "way", osm_id: 2002,
    lat: "51.4544", lon: "-2.6198", category: "building", type: "house", place_rank: 30, importance: 0.2, addresstype: "building",
    display_name: "18, Royal York Crescent, Clifton, Bristol, City of Bristol, England, BS8 4JX, United Kingdom",
    address: { house_number: "18", road: "Royal York Crescent", suburb: "Clifton", city: "Bristol", state: "England", "ISO3166-2-lvl4": "GB-ENG", postcode: "BS8 4JX", country: "United Kingdom", country_code: "gb" },
  },
  {
    place_id: 1003, osm_type: "node", osm_id: 4004, lat: "48.8566", lon: "2.3522", place_rank: 16, display_name: "Paris, France",
    address: { city: "Paris", country_code: "fr" },
  },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const openGate: RateGate = { acquire: async () => true };

describe("postcodes.io adapter", () => {
  it("normalises a matched postcode to an approximate centroid", async () => {
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe("https://api.postcodes.io/postcodes/BS84JX");
      return json(postcodeFixture);
    });
    const result = await lookupPostcode("bs8 4jx", { fetchImpl });
    expect(result).toEqual({ status: "matched", result: expect.objectContaining({ postcode: "BS8 4JX", country: "ENG", adminDistrictCode: "E06000023", positionalQuality: 1 }) });
  });

  it("maps 404 to no match rather than an error", async () => {
    const result = await lookupPostcode("ZZ99 9ZZ", { fetchImpl: vi.fn(async () => json({ status: 404, error: "Postcode not found" }, 404)) });
    expect(result.status).toBe("no_match");
  });

  it("does not query Northern Ireland postcodes until licensed", async () => {
    const fetchImpl = vi.fn();
    expect((await lookupPostcode("BT1 5GS", { fetchImpl })).status).toBe("unsupported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unexpected response shapes", async () => {
    await expect(lookupPostcode("BS8 4JX", { fetchImpl: vi.fn(async () => json({ status: 200, result: { postcode: 5 } })) })).rejects.toThrow(/unexpected/);
  });
});

describe("nominatim adapter", () => {
  const config = { baseUrl: "https://nominatim.example.org", userAgent: "Surveynt-test/1.0 (+https://example.org)", rateGate: openGate };

  it("is not configured without a base URL and identifying user agent", async () => {
    expect((await searchAddress("18 Royal York Crescent", { ...config, userAgent: undefined })).status).toBe("not_configured");
  });

  it("sends an identifying user agent, limits countries and drops non-UK results", async () => {
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/search");
      expect(parsed.searchParams.get("countrycodes")).toBe("gb");
      expect((init?.headers as Record<string, string>)["user-agent"]).toContain("Surveynt-test");
      return json(nominatimFixture);
    });
    const result = await searchAddress("18 Royal York Crescent Bristol", { ...config, fetchImpl });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ precision: "building", country: "ENG", line1: "18 Royal York Crescent", postcode: "BS8 4JX" });
  });

  it("reports busy instead of exceeding the deployment-wide rate", async () => {
    const fetchImpl = vi.fn();
    const result = await searchAddress("18 Royal York Crescent", { ...config, rateGate: { acquire: async () => false }, fetchImpl });
    expect(result.status).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects over-long queries before contacting the provider", async () => {
    expect((await searchAddress("x".repeat(201), config)).status).toBe("invalid");
  });
});
