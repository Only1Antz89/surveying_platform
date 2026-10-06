import { describe, expect, it, vi } from "vitest";
import type { PropertyLocation } from "../contract";
import { runProviders } from "./orchestrator";
import { planningDataProvider } from "./planning-data";
import { legacyEpcProvider as epcProvider, normaliseAgeBand } from "./epc";
import { historicEnglandProvider } from "./reference-layer";
import type { IntelligenceProvider, ProviderContext, SpatialQuery } from "./types";

// Fixtures follow the published response shapes. Values are illustrative test data, not live records.
const planningFixture = {
  entities: [
    { entity: 44000123, dataset: "conservation-area", name: "Clifton", reference: "CA-12", "entry-date": "2023-02-01", "start-date": "1972-01-01", "end-date": "", "organisation-entity": 16, "documentation-url": "https://www.bristol.gov.uk/conservation-areas/clifton" },
    { entity: 31000999, dataset: "article-4-direction-area", name: "Old direction", "end-date": "2001-05-01", "documentation-url": "javascript:alert(1)" },
  ],
  count: 2,
};

const epcFixture = {
  "column-names": ["lmk-key", "address1", "uprn"],
  rows: [
    { "lmk-key": "older", address1: "Flat 2, 1 Test Terrace", uprn: "990000000002", "current-energy-rating": "E", "construction-age-band": "England and Wales: 1900-1929", "lodgement-date": "2014-03-01", "property-type": "Flat", "built-form": "Mid-Terrace" },
    { "lmk-key": "newer", address1: "Flat 2, 1 Test Terrace", uprn: "990000000002", "current-energy-rating": "C", "construction-age-band": "England and Wales: 1900-1929", "lodgement-date": "2023-06-12", "property-type": "Flat", "built-form": "Mid-Terrace", "walls-description": "Solid brick, as built, no insulation" },
    { "lmk-key": "neighbour", address1: "Flat 3", uprn: "990000000003", "current-energy-rating": "B", "lodgement-date": "2024-01-01" },
  ],
};

const location = (overrides: Partial<PropertyLocation> = {}): PropertyLocation => ({ propertyId: "p1", country: "ENG", uprn: "990000000002", latitude: 51.4544, longitude: -2.6198, locationConfidence: "surveyor_confirmed", postcode: "BS8 4JX", ...overrides });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const context = (overrides: Partial<ProviderContext> = {}): ProviderContext => ({ now: new Date("2026-10-01T12:00:00Z"), env: {}, ...overrides });

describe("planning data provider", () => {
  it("separates matched datasets from 'no record found' and never emits a negative claim", async () => {
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      const parsed = new URL(String(url));
      expect(parsed.hostname).toBe("www.planning.data.gov.uk");
      expect(parsed.searchParams.getAll("dataset")).toContain("conservation-area");
      return json(planningFixture);
    });
    const results = await planningDataProvider.run(location(), context({ fetchImpl }));
    const conservation = results.find((item) => item.category === "conservation_area")!;
    expect(conservation).toMatchObject({ status: "matched", coverage: "partial", informationClass: "authoritative_external" });
    expect(conservation.records[0]).toMatchObject({ sourceRecordId: "44000123", matchMethod: "point_in_polygon", confidence: "medium" });
    expect(conservation.records[0].evidence.map((item) => item.url)).toContain("https://www.bristol.gov.uk/conservation-areas/clifton");
    const article4 = results.find((item) => item.category === "article_4_direction")!;
    expect(article4.records[0].data).toMatchObject({ ended: true });
    expect(article4.records[0].evidence.some((item) => item.url.startsWith("javascript:"))).toBe(false);
    const greenBelt = results.find((item) => item.category === "green_belt")!;
    expect(greenBelt).toMatchObject({ status: "no_match", coverage: "partial" });
    expect(greenBelt.message).toMatch(/No record found/);
    expect(conservation.licence.name).toMatch(/Open Government Licence/);
  });

  it("is unsupported outside England and for postcode-centre locations", () => {
    expect(planningDataProvider.applicability(location({ country: "WLS" }), context())).toMatchObject({ ok: false, status: "unsupported", coverage: "not_covered" });
    expect(planningDataProvider.applicability(location({ locationConfidence: "postcode_centroid" }), context())).toMatchObject({ ok: false, status: "unsupported" });
    expect(planningDataProvider.applicability(location({ latitude: null, longitude: null, locationConfidence: "unresolved" }), context())).toMatchObject({ ok: false });
  });
});

describe("EPC provider", () => {
  const env = { EPC_API_BASE_URL: "https://epc.example.gov.uk", EPC_API_EMAIL: "ops@example.test", EPC_API_KEY: "test-key", EPC_LICENCE_ACCEPTED: "true", EPC_DATA_PROTECTION_APPROVED: "true" };

  it("requires configuration, coverage and a confirmed UPRN before querying", () => {
    expect(epcProvider.applicability(location(), context())).toMatchObject({ ok: false, status: "not_configured" });
    expect(epcProvider.applicability(location(), context({ env: { ...env, EPC_LICENCE_ACCEPTED: "false" } }))).toMatchObject({ ok: false, status: "not_configured" });
    expect(epcProvider.applicability(location(), context({ env: { ...env, EPC_DATA_PROTECTION_APPROVED: "false" } }))).toMatchObject({ ok: false, status: "not_configured" });
    expect(epcProvider.applicability(location({ uprn: null }), context({ env }))).toMatchObject({ ok: false, status: "unsupported" });
    expect(epcProvider.applicability(location({ country: "SCT" }), context({ env }))).toMatchObject({ ok: false, status: "unsupported", coverage: "not_covered" });
    expect(epcProvider.applicability(location(), context({ env }))).toEqual({ ok: true });
  });

  it("matches exact UPRN only, orders by lodgement date and drops address fields", async () => {
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(new URL(String(url)).searchParams.get("uprn")).toBe("990000000002");
      expect((init?.headers as Record<string, string>).authorization).toMatch(/^Basic /);
      return json(epcFixture);
    });
    const [certificate] = await epcProvider.run(location(), context({ env, fetchImpl }));
    expect(certificate.status).toBe("matched");
    expect(certificate.records.map((record) => record.sourceRecordId)).toEqual(["newer", "older"]);
    expect(certificate.records[0].data).toMatchObject({ latest: true, currentRating: "C", constructionPeriodKey: "1900_1929", propertyTypeKey: "flat", builtFormKey: "mid_terrace" });
    expect(JSON.stringify(certificate.records)).not.toContain("Test Terrace");
    expect(certificate.records[0].matchMethod).toBe("uprn_exact");
  });

  it("normalises recorded age bands without guessing unfamiliar wording", () => {
    expect(normaliseAgeBand("England and Wales: before 1900")).toBe("before_1900");
    expect(normaliseAgeBand("England and Wales: 2012 onwards")).toBe("2012_onwards");
    expect(normaliseAgeBand("2019")).toBe("2012_onwards");
    expect(normaliseAgeBand("Circa Georgian")).toBeNull();
  });
});

describe("reference layer provider", () => {
  const spatial = (available: boolean): SpatialQuery => ({
    featuresAt: async ({ layers }) => layers.map((layer) => ({
      layer,
      available: available && layer === "listed_building",
      datasetVersion: available ? "2026-09" : null,
      sourceUpdatedAt: null,
      features: layer === "listed_building" ? [
        { featureId: "1202134", name: "1-46 Royal York Crescent", attributes: { ListEntry: 1202134, Grade: "II*" }, distanceMetres: 0, intersects: true },
        { featureId: "1202135", name: "Railings", attributes: { ListEntry: 1202135, Grade: "II" }, distanceMetres: 18, intersects: false },
      ] : [],
    })),
  });

  it("reports unimported layers as not checked rather than no record", async () => {
    const results = await historicEnglandProvider.run(location(), context({ spatial: spatial(true) }));
    expect(results.find((item) => item.category === "scheduled_monument_nhle")).toMatchObject({ status: "not_configured", coverage: "unknown" });
    const listed = results.find((item) => item.category === "listed_building_nhle")!;
    expect(listed).toMatchObject({ status: "matched", datasetVersion: "2026-09" });
    expect(listed.records[0].evidence[0].url).toBe("https://historicengland.org.uk/listing/the-list/list-entry/1202134");
    const nearby = results.find((item) => item.category === "listed_building_nhle_nearby")!;
    expect(nearby).toMatchObject({ status: "matched", informationClass: "indicative_external" });
    expect(nearby.records[0]).toMatchObject({ matchMethod: "point_within_distance", confidence: "low" });
  });
});

describe("orchestrator", () => {
  it("keeps other providers' results when one times out or fails", async () => {
    const slow: IntelligenceProvider = { key: "slow", categories: ["a"], applicability: () => ({ ok: true }), run: () => new Promise(() => undefined) };
    const broken: IntelligenceProvider = { key: "broken", categories: ["b"], applicability: () => ({ ok: true }), run: async () => { throw Object.assign(new Error("bad"), { code: "invalid_response" }); } };
    const fetchImpl = vi.fn(async () => json(planningFixture));
    const outcomes = await runProviders([slow, broken, planningDataProvider], location(), context({ fetchImpl }), { timeoutMs: 50 });
    expect(outcomes.find((item) => item.providerKey === "slow")?.results[0]).toMatchObject({ status: "unavailable", errorCode: "timeout" });
    expect(outcomes.find((item) => item.providerKey === "broken")?.results[0]).toMatchObject({ status: "error", errorCode: "invalid_response" });
    expect(outcomes.find((item) => item.providerKey === "planning_data")?.results.some((item) => item.status === "matched")).toBe(true);
  });

  it("records explicit unsupported results without calling the provider", async () => {
    const run = vi.fn();
    const outcomes = await runProviders([{ ...planningDataProvider, run }], location({ country: "NIR" }), context());
    expect(run).not.toHaveBeenCalled();
    expect(outcomes[0].results.every((item) => item.status === "unsupported")).toBe(true);
  });
});
