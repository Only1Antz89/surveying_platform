import { z } from "zod";

export const providerStatuses = ["matched", "no_match", "unsupported", "not_configured", "unavailable", "error"] as const;
export const propertyCountries = ["ENG", "WLS", "SCT", "NIR"] as const;
export const informationClasses = ["surveyor_verified", "authoritative_external", "indicative_external_context"] as const;
export const coverageStatuses = ["covered", "partial", "outside_coverage", "unknown"] as const;
export type ProviderStatus = (typeof providerStatuses)[number];
export type PropertyCountry = (typeof propertyCountries)[number];
export type InformationClass = (typeof informationClasses)[number];
export type CoverageStatus = (typeof coverageStatuses)[number];

export const propertyLocationSchema = z.object({
  propertyId: z.uuid(),
  country: z.enum(propertyCountries),
  uprn: z.string().regex(/^\d{1,12}$/).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().trim().min(3).max(500),
  propertyVersion: z.number().int().positive(),
});

export type PropertyLocation = z.infer<typeof propertyLocationSchema>;

export type EvidenceLink = { label: string; url: string };
export type NormalisedRecord = {
  sourceRecordId: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  geometry?: GeoJSON.Geometry | null;
  evidence: EvidenceLink[];
  sourceUpdatedAt?: string | null;
};

export type ProviderResult = {
  source: string;
  category: string;
  status: ProviderStatus;
  records: NormalisedRecord[];
  matchMethod: string;
  confidence: number;
  coverage: CoverageStatus;
  informationClass: InformationClass;
  licence: string;
  attribution: string;
  retrievedAt: string;
  expiresAt?: string | null;
  datasetVersion?: string | null;
  safeError?: string | null;
};

export interface PropertyDataProvider {
  key: string;
  supports(country: PropertyCountry): boolean;
  fetch(location: PropertyLocation, signal: AbortSignal): Promise<ProviderResult>;
}

export type AddressCandidate = {
  providerKey: string;
  sourceRecordId: string;
  displayLabel: string;
  line1: string;
  line2: string | null;
  city: string;
  postcode: string;
  country: PropertyCountry;
  latitude: number;
  longitude: number;
  precision: "address" | "street" | "postcode" | "place";
  attribution: string;
};

const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const fetchTimeoutMs = 8_000;

async function fetchJson(url: URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: init.signal ?? controller.signal });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchPostcode(query: string): Promise<AddressCandidate[]> {
  if (!postcodePattern.test(query.trim())) return [];
  const postcode = query.trim().toUpperCase().replace(/\s+/g, "");
  const url = new URL(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
  const payload = z.object({ status: z.number(), result: z.object({ postcode: z.string(), admin_district: z.string().nullable(), latitude: z.number(), longitude: z.number(), country: z.string() }).nullable() }).parse(await fetchJson(url));
  if (!payload.result || payload.result.country !== "England") return [];
  return [{
    providerKey: "postcodes_io",
    sourceRecordId: payload.result.postcode,
    displayLabel: `${payload.result.postcode}${payload.result.admin_district ? `, ${payload.result.admin_district}` : ""}`,
    line1: "",
    line2: null,
    city: payload.result.admin_district ?? "",
    postcode: payload.result.postcode,
    country: "ENG",
    latitude: payload.result.latitude,
    longitude: payload.result.longitude,
    precision: "postcode",
    attribution: "Contains OS, Royal Mail and National Statistics data",
  }];
}

export async function searchNominatim(query: string, configuration: { baseUrl?: string; userAgent?: string }): Promise<AddressCandidate[]> {
  if (!configuration.baseUrl || !configuration.userAgent) return [];
  const url = new URL("search", configuration.baseUrl.endsWith("/") ? configuration.baseUrl : `${configuration.baseUrl}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "gb");
  url.searchParams.set("limit", "8");
  const itemSchema = z.object({
    place_id: z.union([z.string(), z.number()]),
    display_name: z.string(),
    lat: z.string(),
    lon: z.string(),
    type: z.string().optional(),
    address: z.record(z.string(), z.string()).optional(),
  });
  const payload = z.array(itemSchema).parse(await fetchJson(url, { headers: { "User-Agent": configuration.userAgent } }));
  return payload.flatMap((item) => {
    const address = item.address ?? {};
    const countryCode = address.country_code?.toLowerCase();
    if (countryCode !== "gb" || address.state === "Wales" || address.state === "Scotland" || address.state === "Northern Ireland") return [];
    const house = [address.house_number, address.house_name].filter(Boolean).join(" ");
    const road = address.road ?? address.pedestrian ?? address.residential ?? "";
    return [{
      providerKey: "nominatim",
      sourceRecordId: String(item.place_id),
      displayLabel: item.display_name,
      line1: [house, road].filter(Boolean).join(" ") || item.display_name.split(",")[0],
      line2: address.suburb ?? null,
      city: address.city ?? address.town ?? address.village ?? address.county ?? "",
      postcode: address.postcode ?? "",
      country: "ENG" as const,
      latitude: Number(item.lat),
      longitude: Number(item.lon),
      precision: address.house_number || address.house_name ? "address" as const : road ? "street" as const : "place" as const,
      attribution: "© OpenStreetMap contributors",
    }];
  });
}

export function locationFingerprint(location: Pick<PropertyLocation, "country" | "uprn" | "latitude" | "longitude" | "propertyVersion">) {
  return [location.country, location.uprn ?? "", location.latitude.toFixed(7), location.longitude.toFixed(7), location.propertyVersion].join(":");
}

export const sourceRegistry = [
  { key: "os_open_uprn", name: "OS Open UPRN", organisation: "Ordnance Survey", documentationUrl: "https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-uprn", coverage: ["ENG"], category: "identity", licence: "OS OpenData Licence", informationClass: "authoritative_external" },
  { key: "planning_data", name: "Planning Data", organisation: "MHCLG", documentationUrl: "https://www.planning.data.gov.uk/docs", coverage: ["ENG"], category: "planning", licence: "Open Government Licence v3.0", informationClass: "authoritative_external" },
  { key: "epc", name: "Energy Performance of Buildings Data", organisation: "MHCLG", documentationUrl: "https://get-energy-performance-data.communities.gov.uk/", coverage: ["ENG"], category: "energy", licence: "Provider terms and address restrictions apply", informationClass: "authoritative_external" },
  { key: "historic_england", name: "National Heritage List for England", organisation: "Historic England", documentationUrl: "https://historicengland.org.uk/listing/the-list/data-downloads", coverage: ["ENG"], category: "heritage", licence: "Open Government Licence v3.0", informationClass: "authoritative_external" },
  { key: "hmlr_inspire", name: "INSPIRE Index Polygons", organisation: "HM Land Registry", documentationUrl: "https://www.gov.uk/guidance/inspire-index-polygons-spatial-data", coverage: ["ENG"], category: "land", licence: "Open Government Licence v3.0", informationClass: "indicative_external_context" },
  { key: "ea_flood_zone_2", name: "Flood Map for Planning — Flood Zone 2", organisation: "Environment Agency", documentationUrl: "https://environment.data.gov.uk/support/faqs/778338325/798130238", coverage: ["ENG"], category: "environment", licence: "Open Government Licence v3.0", informationClass: "indicative_external_context" },
  { key: "ea_flood_zone_3", name: "Flood Map for Planning — Flood Zone 3", organisation: "Environment Agency", documentationUrl: "https://environment.data.gov.uk/support/faqs/778338325/798130238", coverage: ["ENG"], category: "environment", licence: "Open Government Licence v3.0", informationClass: "indicative_external_context" },
] as const;

function baseResult(source: string, category: string): Omit<ProviderResult, "status" | "records" | "matchMethod" | "confidence" | "coverage" | "informationClass" | "licence" | "attribution"> {
  return { source, category, retrievedAt: new Date().toISOString(), datasetVersion: null, expiresAt: null, safeError: null };
}

export const planningDataProvider: PropertyDataProvider = {
  key: "planning_data",
  supports: (country) => country === "ENG",
  async fetch(location, signal) {
    if (location.country !== "ENG") return { ...baseResult("planning_data", "planning"), status: "unsupported", records: [], matchMethod: "country", confidence: 1, coverage: "outside_coverage", informationClass: "authoritative_external", licence: "Open Government Licence v3.0", attribution: "© Crown copyright and database right" };
    const url = new URL("https://www.planning.data.gov.uk/entity.json");
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    ["conservation-area", "listed-building", "article-4-direction-area", "tree-preservation-zone", "green-belt", "ancient-woodland", "site-of-special-scientific-interest"].forEach((dataset) => url.searchParams.append("dataset", dataset));
    url.searchParams.set("limit", "100");
    try {
      const payload = z.object({ entities: z.array(z.record(z.string(), z.unknown())).default([]) }).passthrough().parse(await fetchJson(url, { signal }));
      const records = payload.entities.map((entity, index) => ({
        sourceRecordId: String(entity.entity ?? entity.reference ?? index),
        title: String(entity.name || entity.dataset || "Planning constraint"),
        summary: String(entity.dataset ?? "Planning Data record"),
        data: entity,
        evidence: [{ label: "Planning Data record", url: entity.entity ? `https://www.planning.data.gov.uk/entity/${entity.entity}` : "https://www.planning.data.gov.uk/" }],
        sourceUpdatedAt: typeof entity["entry-date"] === "string" ? entity["entry-date"] : null,
      }));
      return { ...baseResult("planning_data", "planning"), status: records.length ? "matched" : "no_match", records, matchMethod: "point_intersection", confidence: 0.9, coverage: "partial", informationClass: "authoritative_external", licence: "Open Government Licence v3.0", attribution: "© Crown copyright and database right" };
    } catch (error) {
      return { ...baseResult("planning_data", "planning"), status: error instanceof DOMException && error.name === "AbortError" ? "unavailable" : "error", records: [], matchMethod: "point_intersection", confidence: 0, coverage: "unknown", informationClass: "authoritative_external", licence: "Open Government Licence v3.0", attribution: "© Crown copyright and database right", safeError: "Planning Data could not be checked." };
    }
  },
};

export function epcProvider(configuration: { email?: string; apiKey?: string; baseUrl?: string }): PropertyDataProvider {
  return {
    key: "epc",
    supports: (country) => country === "ENG" || country === "WLS",
    async fetch(location, signal) {
      if (!configuration.email || !configuration.apiKey) return { ...baseResult("epc", "energy"), status: "not_configured", records: [], matchMethod: "uprn", confidence: 0, coverage: "unknown", informationClass: "authoritative_external", licence: "Provider terms and address restrictions apply", attribution: "Energy Performance of Buildings Data" };
      if (!location.uprn) return { ...baseResult("epc", "energy"), status: "no_match", records: [], matchMethod: "uprn_required", confidence: 0, coverage: "partial", informationClass: "authoritative_external", licence: "Provider terms and address restrictions apply", attribution: "Energy Performance of Buildings Data" };
      const url = new URL("api/v1/domestic/search", configuration.baseUrl ?? "https://epc.opendatacommunities.org/");
      url.searchParams.set("uprn", location.uprn);
      try {
        const payload = z.object({ rows: z.array(z.record(z.string(), z.unknown())).default([]) }).passthrough().parse(await fetchJson(url, { signal, headers: { Authorization: `Basic ${btoa(`${configuration.email}:${configuration.apiKey}`)}`, Accept: "application/json" } }));
        const records = payload.rows.map((row, index) => ({ sourceRecordId: String(row["lmk-key"] ?? index), title: `EPC ${String(row["current-energy-rating"] ?? "record")}`, summary: `Lodged ${String(row["lodgement-date"] ?? "date unknown")}`, data: row, evidence: [], sourceUpdatedAt: typeof row["lodgement-date"] === "string" ? row["lodgement-date"] : null }));
        return { ...baseResult("epc", "energy"), status: records.length ? "matched" : "no_match", records, matchMethod: "uprn", confidence: 1, coverage: "covered", informationClass: "authoritative_external", licence: "Provider terms and address restrictions apply", attribution: "Energy Performance of Buildings Data" };
      } catch {
        return { ...baseResult("epc", "energy"), status: "error", records: [], matchMethod: "uprn", confidence: 0, coverage: "unknown", informationClass: "authoritative_external", licence: "Provider terms and address restrictions apply", attribution: "Energy Performance of Buildings Data", safeError: "EPC data could not be checked." };
      }
    },
  };
}

declare namespace GeoJSON {
  type Geometry = { type: string; coordinates: unknown };
}
