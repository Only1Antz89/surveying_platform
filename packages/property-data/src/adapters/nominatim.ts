import { z } from "zod";
import type { UkCountry } from "@surveynt/domain";
import type { LicenceSnapshot } from "../contract";
import { isWithinUkBounds, normalisePostcode } from "../matching/identity";
import { providerFetchJson, type ProviderFetchOptions } from "../http/provider-fetch";

export const nominatimLicence: LicenceSnapshot = {
  name: "Open Database License (ODbL) 1.0",
  url: "https://www.openstreetmap.org/copyright",
  attribution: "© OpenStreetMap contributors",
  restrictions: [
    "Public server usage policy: at most one request per second for the whole application, no autocomplete, identifying User-Agent, cache results.",
    "Results are community-maintained and may be incomplete or out of date.",
  ],
};

/**
 * Deployment-wide request spacing. Implementations must coordinate across
 * server instances (the web app uses a database-backed gate).
 */
export interface RateGate {
  /** Resolves true once a request slot is reserved, or false if waiting would exceed `maxWaitMs`. */
  acquire(key: string, minIntervalMs: number, maxWaitMs: number): Promise<boolean>;
}

const isoCountry: Record<string, UkCountry> = { "GB-ENG": "ENG", "GB-WLS": "WLS", "GB-SCT": "SCT", "GB-NIR": "NIR" };

const placeSchema = z.object({
  place_id: z.number(),
  osm_type: z.string().optional(),
  osm_id: z.number().optional(),
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  place_rank: z.number().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  address: z.record(z.string(), z.string()).optional(),
});

export type AddressPrecision = "building" | "street" | "area";

export type GeocodedAddress = {
  providerRef: string;
  label: string;
  latitude: number;
  longitude: number;
  precision: AddressPrecision;
  country: UkCountry | null;
  line1: string | null;
  city: string | null;
  postcode: string | null;
};

export type NominatimConfig = Pick<ProviderFetchOptions, "fetchImpl" | "timeoutMs"> & {
  baseUrl: string | undefined;
  userAgent: string | undefined;
  minIntervalMs?: number;
  rateGate: RateGate;
};

export type NominatimSearchResult =
  | { status: "matched"; results: GeocodedAddress[] }
  | { status: "no_match" | "not_configured" | "unavailable" | "invalid"; message: string };

function precisionFor(rank: number | undefined): AddressPrecision {
  if (rank !== undefined && rank >= 28) return "building";
  if (rank !== undefined && rank >= 26) return "street";
  return "area";
}

function normalise(place: z.infer<typeof placeSchema>): GeocodedAddress | null {
  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  if (!isWithinUkBounds(latitude, longitude)) return null;
  const address = place.address ?? {};
  const street = [address.house_number, address.house_name, address.road].filter(Boolean).join(" ").trim();
  return {
    providerRef: `${place.osm_type ?? "place"}:${place.osm_id ?? place.place_id}`,
    label: place.display_name,
    latitude,
    longitude,
    precision: precisionFor(place.place_rank),
    country: isoCountry[address["ISO3166-2-lvl4"] ?? ""] ?? null,
    line1: street || null,
    city: address.city ?? address.town ?? address.village ?? address.hamlet ?? null,
    postcode: address.postcode ? normalisePostcode(address.postcode) : null,
  };
}

/** Explicit, user-submitted search only. Never call this per keystroke. */
export async function searchAddress(query: string, config: NominatimConfig): Promise<NominatimSearchResult> {
  const text = query.trim().replace(/\s+/g, " ");
  if (text.length < 3 || text.length > 200) return { status: "invalid", message: "Enter between 3 and 200 characters." };
  if (!config.baseUrl || !config.userAgent) return { status: "not_configured", message: "Address search is not configured. Enter the address manually." };
  const base = new URL(config.baseUrl);
  const reserved = await config.rateGate.acquire("nominatim", config.minIntervalMs ?? 1100, 4000);
  if (!reserved) return { status: "unavailable", message: "Address search is busy. Try again shortly or enter the address manually." };
  const url = new URL("search", base.href.endsWith("/") ? base : new URL(`${base.href}/`));
  url.search = new URLSearchParams({ q: text, format: "jsonv2", addressdetails: "1", limit: "5", countrycodes: "gb" }).toString();
  const response = await providerFetchJson(url, { allowedHosts: [base.hostname], timeoutMs: config.timeoutMs ?? 6000, maxBytes: 500_000, userAgent: config.userAgent, fetchImpl: config.fetchImpl });
  const parsed = z.array(placeSchema).max(50).safeParse(response.body);
  if (!parsed.success) throw Object.assign(new Error("Nominatim returned an unexpected response."), { code: "invalid_response" });
  const results = parsed.data.map(normalise).filter((item): item is GeocodedAddress => item !== null);
  return results.length ? { status: "matched", results } : { status: "no_match", message: "No matching addresses were found. Enter the address manually." };
}
