import { lookupPostcode } from "../adapters/postcodes-io";
import { normalisePostcode } from "../matching/identity";
import { result, type IntelligenceProvider } from "./types";

export const postcodeGeographyProvider: IntelligenceProvider = {
  key: "postcodes_io", categories: ["postcode_geography"],
  applicability(location) {
    if (location.country !== "ENG") return { ok: false, status: "unsupported", coverage: "not_covered", message: "Administrative geography preloading is England-first." };
    if (!normalisePostcode(location.postcode ?? "")) return { ok: false, status: "unsupported", coverage: "unknown", message: "A valid postcode is required." };
    return { ok: true };
  },
  async run(location, context) {
    const load = () => lookupPostcode(location.postcode!, { baseUrl: context.env.POSTCODES_IO_BASE_URL, fetchImpl: context.fetchImpl });
    const postcode = normalisePostcode(location.postcode!)!;
    const lookup = context.cache ? await context.cache.getOrLoad(`postcodes_io|administrative-v1|${postcode}`, 30, load, value => value.status === "matched" || value.status === "no_match") : await load();
    if (lookup.status !== "matched") return [result(this.key, { category: "postcode_geography", now: context.now, status: lookup.status === "no_match" ? "no_match" : "unsupported", coverage: "unknown", message: lookup.message })];
    return [result(this.key, { category: "postcode_geography", now: context.now, status: "matched", coverage: "partial", records: [{ category: "postcode_geography", sourceRecordId: lookup.result.postcode, data: { postcode: lookup.result.postcode, adminDistrict: lookup.result.adminDistrict, adminDistrictCode: lookup.result.adminDistrictCode, region: lookup.result.region, adminWard: lookup.result.adminWard, positionalQuality: lookup.result.positionalQuality }, evidence: [{ label: "Postcodes.io administrative geography", url: "https://postcodes.io/docs/postcode/schema/" }], matchMethod: "postcode", confidence: "low", sourceUpdatedAt: null }], message: "Postcode-level geography only: approximate, not a property-specific classification or description." })];
  },
};
