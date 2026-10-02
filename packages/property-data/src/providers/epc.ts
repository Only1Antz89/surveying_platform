import { z } from "zod";
import type { ProviderRecord } from "../contract";
import { providerFetchJson, withTransientRetry } from "../http/provider-fetch";
import { result, type IntelligenceProvider, type ProviderContext } from "./types";

// Energy Performance of Buildings data (England & Wales). The request and
// response shape follows the published domestic search API (search by UPRN).
// The service moved to get-energy-performance-data.communities.gov.uk in 2026;
// endpoint and authentication must be re-verified before enabling
// (docs/property-intelligence/source-register.md).

const sourceKey = "epc_england_wales";

const rowSchema = z.object({
  "lmk-key": z.string().min(1),
  uprn: z.union([z.string(), z.number()]).nullish(),
  "current-energy-rating": z.string().nullish(),
  "potential-energy-rating": z.string().nullish(),
  "current-energy-efficiency": z.union([z.string(), z.number()]).nullish(),
  "property-type": z.string().nullish(),
  "built-form": z.string().nullish(),
  "construction-age-band": z.string().nullish(),
  "lodgement-date": z.string().nullish(),
  "inspection-date": z.string().nullish(),
  "total-floor-area": z.union([z.string(), z.number()]).nullish(),
  "main-fuel": z.string().nullish(),
  "mainheat-description": z.string().nullish(),
  "walls-description": z.string().nullish(),
  "roof-description": z.string().nullish(),
  "windows-description": z.string().nullish(),
  "floor-description": z.string().nullish(),
}).passthrough();

const responseSchema = z.object({ rows: z.array(rowSchema).max(500) }).passthrough();

/** Maps a recorded EPC age band onto the form's construction periods. Unknown wording stays unmapped. */
export function normaliseAgeBand(band: string | null | undefined) {
  if (!band) return null;
  const text = band.replace(/^England and Wales:\s*/i, "").trim().toLowerCase();
  if (text.includes("before 1900")) return "before_1900";
  if (/2012\s*onwards/.test(text)) return "2012_onwards";
  const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(text);
  if (range) {
    const key = `${range[1]}_${range[2]}`;
    return ["1900_1929", "1930_1949", "1950_1966", "1967_1975", "1976_1982", "1983_1990", "1991_1995", "1996_2002", "2003_2006", "2007_2011"].includes(key) ? key : null;
  }
  const year = /^(\d{4})$/.exec(text);
  if (year && Number(year[1]) >= 2012) return "2012_onwards";
  return null;
}

const propertyTypes: Record<string, string> = { house: "house", bungalow: "bungalow", flat: "flat", maisonette: "maisonette", "park home": "park_home" };
const builtForms: Record<string, string> = { detached: "detached", "semi-detached": "semi_detached", "mid-terrace": "mid_terrace", "end-terrace": "end_terrace", "enclosed mid-terrace": "enclosed_mid_terrace", "enclosed end-terrace": "enclosed_end_terrace" };

function authHeader(env: ProviderContext["env"]) {
  if (env.EPC_API_TOKEN) return `Bearer ${env.EPC_API_TOKEN}`;
  if (env.EPC_API_EMAIL && env.EPC_API_KEY) return `Basic ${btoa(`${env.EPC_API_EMAIL}:${env.EPC_API_KEY}`)}`;
  return null;
}

export const epcProvider: IntelligenceProvider = {
  key: sourceKey,
  categories: ["energy_certificate"],
  applicability(location, context) {
    if (location.country !== "ENG" && location.country !== "WLS") return { ok: false, status: "unsupported", message: location.country ? "This EPC register covers England and Wales only." : "Set the property's country to check energy certificates.", coverage: location.country ? "not_covered" : "unknown" };
    if (!context.env.EPC_API_BASE_URL || !authHeader(context.env)) return { ok: false, status: "not_configured", message: "EPC access is not configured for this deployment.", coverage: "unknown" };
    if (!location.uprn) return { ok: false, status: "unsupported", message: "EPC records are matched by confirmed UPRN only. Confirm the property's UPRN to check them.", coverage: "unknown" };
    return { ok: true };
  },
  async run(location, context) {
    const base = new URL(context.env.EPC_API_BASE_URL!);
    const url = new URL("api/v1/domestic/search", base.href.endsWith("/") ? base : new URL(`${base.href}/`));
    url.searchParams.set("uprn", location.uprn!);
    url.searchParams.set("size", "50");
    const load = async () => (await withTransientRetry(() => providerFetchJson(url, { allowedHosts: [base.hostname], timeoutMs: 8000, maxBytes: 2_000_000, fetchImpl: context.fetchImpl, headers: { authorization: authHeader(context.env)! }, notFoundIsEmpty: true }))).body ?? { rows: [] };
    const body = context.cache ? await context.cache.getOrLoad(`${sourceKey}|v1|uprn:${location.uprn}`, 30, load, () => true) : await load();
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw Object.assign(new Error("The EPC service returned an unexpected response."), { code: "invalid_response" });
    // Defensive: keep only certificates lodged against exactly this UPRN.
    const rows = parsed.data.rows.filter((row) => row.uprn !== null && row.uprn !== undefined && String(row.uprn) === location.uprn);
    if (!rows.length) return [result(sourceKey, { category: "energy_certificate", status: "no_match", coverage: "covered", now: context.now, message: "No energy certificate is lodged against this UPRN. Older certificates may not carry a UPRN." })];
    const sorted = [...rows].sort((a, b) => (b["lodgement-date"] ?? "").localeCompare(a["lodgement-date"] ?? ""));
    const records: ProviderRecord[] = sorted.map((row, index) => ({
      sourceRecordId: row["lmk-key"],
      category: "energy_certificate",
      // Address fields are deliberately not stored (separate licence restrictions).
      data: {
        latest: index === 0,
        currentRating: row["current-energy-rating"] ?? null,
        potentialRating: row["potential-energy-rating"] ?? null,
        currentEfficiency: row["current-energy-efficiency"] !== null && row["current-energy-efficiency"] !== undefined ? Number(row["current-energy-efficiency"]) : null,
        propertyType: row["property-type"] ?? null,
        propertyTypeKey: propertyTypes[(row["property-type"] ?? "").toLowerCase()] ?? null,
        builtForm: row["built-form"] ?? null,
        builtFormKey: builtForms[(row["built-form"] ?? "").toLowerCase()] ?? null,
        constructionAgeBand: row["construction-age-band"] ?? null,
        constructionPeriodKey: normaliseAgeBand(row["construction-age-band"]),
        lodgementDate: row["lodgement-date"] ?? null,
        inspectionDate: row["inspection-date"] ?? null,
        totalFloorAreaM2: row["total-floor-area"] !== null && row["total-floor-area"] !== undefined ? Number(row["total-floor-area"]) : null,
        mainFuel: row["main-fuel"] ?? null,
        heating: row["mainheat-description"] ?? null,
        walls: row["walls-description"] ?? null,
        roof: row["roof-description"] ?? null,
        windows: row["windows-description"] ?? null,
        floor: row["floor-description"] ?? null,
      },
      evidence: [{ label: "Energy Performance of Buildings data", url: "https://get-energy-performance-data.communities.gov.uk/" }],
      matchMethod: "uprn_exact",
      confidence: "high",
      sourceUpdatedAt: row["lodgement-date"] ?? null,
    }));
    return [result(sourceKey, { category: "energy_certificate", status: "matched", records, coverage: "covered", now: context.now, message: "EPC record: verify during inspection. Certificates may be out of date." })];
  },
};
