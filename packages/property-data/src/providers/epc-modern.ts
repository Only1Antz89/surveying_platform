import { z } from "zod";
import { ProviderError, providerFetchJson, withTransientRetry } from "../http/provider-fetch";
import { result, type IntelligenceProvider } from "./types";

const sourceKey = "epc_england_wales";
const searchSchema = z.object({ data: z.array(z.object({ certificateNumber: z.string().min(1).max(100), uprn: z.union([z.string(), z.number()]).nullish(), registrationDate: z.string().nullish(), schemaType: z.string().nullish() })).max(100) });
const detailSchema = z.object({ data: z.record(z.string(), z.unknown()) });
// Only fixture-verified versions are decoded. Extend after adding an official fixture regression.
const supportedSchemas = new Set(["RdSAP-Schema-19.0", "RdSAP-Schema-20.0.0", "RdSAP-Schema-21.0.1"]);
const text = (value: unknown) => typeof value === "string" && value.trim() && value.length <= 4000 ? value.trim() : null;
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const displayText = (value: unknown) => text(value) ?? (value && typeof value === "object" ? text((value as Record<string, unknown>).value) : null);
const moneyValue = (value: unknown) => numeric(value) ?? (value && typeof value === "object" && (value as Record<string, unknown>).currency === "GBP" ? numeric((value as Record<string, unknown>).value) : null);
const band = (value: unknown) => typeof value === "string" && /^[A-G]$/.test(value) ? value : null;
export const paddedEpcUprn = (value: unknown) => (typeof value === "string" || typeof value === "number") && /^\d{1,12}$/.test(String(value)) ? String(value).padStart(12, "0") : null;
function description(value: unknown): string | null {
  if (Array.isArray(value)) return value.slice(0, 20).map(description).filter(Boolean).join("; ") || null;
  if (!value || typeof value !== "object") return null;
  const detail = (value as Record<string, unknown>).description;
  return displayText(detail);
}

/** Retain display descriptions, not raw assessor/customer/address data or guessed numeric codes. */
export function normaliseDomesticCertificate(data: Record<string, unknown>, schemaType: string | null) {
  const schema = text(data.schema_type) ?? schemaType;
  const supported = !!schema && supportedSchemas.has(schema);
  const recommendations = supported && Array.isArray(data.suggested_improvements) ? data.suggested_improvements.slice(0, 30).flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const details = item.improvement_details && typeof item.improvement_details === "object" ? item.improvement_details as Record<string, unknown> : {};
    const texts = details.improvement_texts && typeof details.improvement_texts === "object" ? details.improvement_texts as Record<string, unknown> : {};
    return [{ sequence: numeric(item.sequence), improvementCode: numeric(details.improvement_number), description: displayText(details.improvement_description) ?? displayText(texts.improvement_description), summary: displayText(texts.improvement_summary), indicativeCost: text(item.indicative_cost), indicativeCostAmount: moneyValue(item.indicative_cost), typicalSaving: moneyValue(item.typical_saving), currency: "GBP" }];
  }) : [];
  return {
    normalisationVersion: "domestic-json-v3", schemaType: schema, schemaSupported: supported,
    currentRating: band(data.current_energy_efficiency_band), potentialRating: band(data.potential_energy_efficiency_band),
    currentEfficiency: supported ? numeric(data.energy_rating_current) : null,
    potentialEfficiency: supported ? numeric(data.energy_rating_potential) : null,
    propertyType: supported ? displayText(data.dwelling_type) : null, propertyTypeKey: null, builtForm: null, builtFormKey: null,
    constructionAgeBand: null, constructionPeriodKey: null,
    lodgementDate: text(data.registration_date), inspectionDate: supported ? text(data.inspection_date) : null,
    totalFloorAreaM2: supported ? numeric(data.total_floor_area) : null,
    habitableRoomCount: supported ? numeric(data.habitable_room_count) : null,
    heating: supported ? description(data.main_heating) : null, hotWater: supported ? description(data.hot_water) : null,
    walls: supported ? description(data.walls) : null, roof: supported ? description(data.roofs) : null,
    windows: supported ? description(data.window) : null, floor: supported ? description(data.floors) : null,
    mainFuel: null, recommendations,
    unavailableFields: supported ? ["constructionAgeBand", "mainFuel", "builtForm"] : ["construction", "heating", "hotWater", "accommodation", "recommendations"],
  };
}

export const modernEpcProvider: IntelligenceProvider = {
  key: sourceKey, categories: ["energy_certificate"],
  applicability(location, context) {
    if (location.country !== "ENG" && location.country !== "WLS") return { ok: false, status: "unsupported", message: "This EPC register covers England and Wales only.", coverage: location.country ? "not_covered" : "unknown" };
    if (!context.env.EPC_API_TOKEN) return { ok: false, status: "not_configured", message: "Configure a bearer token for the current EPC service. Legacy basic credentials are not used.", coverage: "unknown" };
    if (context.env.EPC_LICENCE_ACCEPTED !== "true" || context.env.EPC_DATA_PROTECTION_APPROVED !== "true") return { ok: false, status: "not_configured", message: "Licence acceptance and data-protection approval are required.", coverage: "unknown" };
    if (!paddedEpcUprn(location.uprn) || location.locationConfidence !== "surveyor_confirmed") return { ok: false, status: "unsupported", message: "Confirm the property's UPRN before checking EPC records.", coverage: "unknown" };
    return { ok: true };
  },
  async run(location, context) {
    const eligibility = this.applicability(location, context);
    if (!eligibility.ok) return [result(sourceKey, { category: "energy_certificate", ...eligibility, now: context.now })];
    const base = new URL(context.env.EPC_API_BASE_URL ?? "https://api.get-energy-performance-data.communities.gov.uk");
    const fetchJson = async (url: URL) => (await withTransientRetry(() => providerFetchJson(url, { allowedHosts: [base.hostname], timeoutMs: 8000, maxBytes: 2_000_000, fetchImpl: context.fetchImpl, headers: { authorization: `Bearer ${context.env.EPC_API_TOKEN}` } }))).body;
    const uprn = paddedEpcUprn(location.uprn)!;
    const url = new URL("/api/domestic/search", base);
    url.searchParams.set("uprn", uprn); url.searchParams.set("page_size", "100"); url.searchParams.set("current_page", "1");
    // Cache normalised records only; search/detail responses contain separately licensed addresses.
    const load = async () => {
      const parsed = searchSchema.safeParse(await fetchJson(url));
      if (!parsed.success) throw new ProviderError("invalid_response", "Unexpected EPC search response.");
      const matched = parsed.data.data.filter(row => paddedEpcUprn(row.uprn) === uprn).sort((a, b) => (b.registrationDate ?? "").localeCompare(a.registrationDate ?? "") || a.certificateNumber.localeCompare(b.certificateNumber));
      const unique = [...new Map(matched.map(row => [row.certificateNumber, row])).values()].slice(0, 10);
      const records = [];
      for (const row of unique) {
        const detailUrl = new URL("/api/certificate", base); detailUrl.searchParams.set("certificate_number", row.certificateNumber);
        const detail = detailSchema.safeParse(await fetchJson(detailUrl));
        if (!detail.success || paddedEpcUprn(detail.data.data.uprn) !== uprn) throw new ProviderError("invalid_response", "EPC certificate identity could not be verified.");
        records.push({ sourceRecordId: row.certificateNumber, category: "energy_certificate", data: { ...normaliseDomesticCertificate(detail.data.data, row.schemaType ?? null), latest: records.length === 0 }, evidence: [{ label: "Official energy certificate", url: "https://get-energy-performance-data.communities.gov.uk/" }], matchMethod: "uprn_exact" as const, confidence: "high" as const, sourceUpdatedAt: row.registrationDate ?? null });
      }
      return records;
    };
    const records = context.cache ? await context.cache.getOrLoad(`${sourceKey}|domestic-json-v3|uprn:${uprn}`, 30, load, () => true) : await load();
    return [result(sourceKey, { category: "energy_certificate", status: records.length ? "matched" : "no_match", records, coverage: "partial", now: context.now, message: records.length ? "Historical certificates: verify descriptions during inspection. Unsupported fields remain unavailable." : "No matching certificate found. Older certificates may not carry a UPRN; absence does not prove no certificate exists." })];
  },
};
