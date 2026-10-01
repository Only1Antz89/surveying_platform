import { z } from "zod";
import type { PropertyLocation, ProviderRecord } from "../contract";
import { providerFetchJson, withTransientRetry } from "../http/provider-fetch";
import { confidenceForLocation, requiresPreciseLocation, result, type IntelligenceProvider, type ProviderContext } from "./types";

// Planning Data datasets queried by point. Dataset keys must be re-checked
// against https://www.planning.data.gov.uk/dataset/ when the source is verified.
export const planningDatasets = [
  { dataset: "conservation-area", category: "conservation_area", label: "Conservation area" },
  { dataset: "listed-building-outline", category: "listed_building", label: "Listed building outline" },
  { dataset: "article-4-direction-area", category: "article_4_direction", label: "Article 4 direction area" },
  { dataset: "tree-preservation-zone", category: "tree_preservation", label: "Tree preservation zone" },
  { dataset: "scheduled-monument", category: "scheduled_monument", label: "Scheduled monument" },
  { dataset: "park-and-garden", category: "registered_park_garden", label: "Registered park and garden" },
  { dataset: "world-heritage-site", category: "world_heritage_site", label: "World Heritage Site" },
  { dataset: "green-belt", category: "green_belt", label: "Green belt" },
] as const;

const entitySchema = z.object({
  entity: z.union([z.number(), z.string()]),
  dataset: z.string(),
  name: z.string().nullish(),
  reference: z.string().nullish(),
  "entry-date": z.string().nullish(),
  "start-date": z.string().nullish(),
  "end-date": z.string().nullish(),
  "organisation-entity": z.union([z.string(), z.number()]).nullish(),
  "documentation-url": z.string().nullish(),
}).passthrough();

const responseSchema = z.object({ entities: z.array(entitySchema).max(1000) }).passthrough();

const sourceKey = "planning_data";

export function planningDataBaseUrl(env: ProviderContext["env"]) {
  return new URL(env.PLANNING_DATA_BASE_URL ?? "https://www.planning.data.gov.uk");
}

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^https?:\/\//.test(value));
}

export const planningDataProvider: IntelligenceProvider = {
  key: sourceKey,
  categories: planningDatasets.map((item) => item.category),
  applicability(location) {
    if (location.country !== "ENG") return { ok: false, status: "unsupported", message: location.country ? "Planning Data covers England only." : "Set the property's country to check planning records.", coverage: location.country ? "not_covered" : "unknown" };
    return requiresPreciseLocation(location) ?? { ok: true };
  },
  async run(location: PropertyLocation, context: ProviderContext) {
    const base = planningDataBaseUrl(context.env);
    const url = new URL("/entity.json", base);
    url.searchParams.set("longitude", location.longitude!.toFixed(6));
    url.searchParams.set("latitude", location.latitude!.toFixed(6));
    url.searchParams.set("limit", "100");
    for (const item of planningDatasets) url.searchParams.append("dataset", item.dataset);
    const load = async () => (await withTransientRetry(() => providerFetchJson(url, { allowedHosts: [base.hostname], timeoutMs: 8000, maxBytes: 5_000_000, fetchImpl: context.fetchImpl }))).body;
    const body = context.cache ? await context.cache.getOrLoad(`planning_data|v1|${url.search}`, 7, load, () => true) : await load();
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw Object.assign(new Error("Planning Data returned an unexpected response."), { code: "invalid_response" });
    const now = context.now;
    return planningDatasets.map((item) => {
      const entities = parsed.data.entities.filter((entity) => entity.dataset === item.dataset);
      if (!entities.length) return result(sourceKey, { category: item.category, status: "no_match", coverage: "partial", now, message: `No record found in the ${item.label.toLowerCase()} dataset. Coverage varies by local planning authority, so check with the council.` });
      const records: ProviderRecord[] = entities.map((entity) => {
        const ended = Boolean(entity["end-date"] && Date.parse(entity["end-date"]) <= now.getTime());
        return {
          sourceRecordId: String(entity.entity),
          category: item.category,
          data: { dataset: item.dataset, label: item.label, name: entity.name ?? null, reference: entity.reference ?? null, startDate: entity["start-date"] ?? null, endDate: entity["end-date"] ?? null, ended, organisationEntity: entity["organisation-entity"] ?? null },
          evidence: [{ label: "Planning Data record", url: `https://www.planning.data.gov.uk/entity/${encodeURIComponent(String(entity.entity))}` }, ...(isHttpUrl(entity["documentation-url"]) ? [{ label: "Local authority documentation", url: entity["documentation-url"] }] : [])],
          matchMethod: "point_in_polygon",
          confidence: confidenceForLocation(location),
          sourceUpdatedAt: entity["entry-date"] ?? null,
        };
      });
      return result(sourceKey, { category: item.category, status: "matched", records, coverage: "partial", now, message: "Planning records are incomplete in places; confirm with the local planning authority." });
    });
  },
};
