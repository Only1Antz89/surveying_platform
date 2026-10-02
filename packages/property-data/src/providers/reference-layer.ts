import type { UkCountry } from "@surveynt/domain";
import type { InformationClass, ProviderRecord } from "../contract";
import { confidenceForLocation, requiresPreciseLocation, result, type IntelligenceProvider } from "./types";

export type LayerDefinition = {
  layer: string;
  category: string;
  label: string;
  /** Also report features within this distance as separate, indicative "nearby" context. Never a match. */
  nearbyMetres?: number;
  caveat: string;
  evidenceUrl?: (featureId: string, attributes: Record<string, unknown>) => string | null;
};

export type ReferenceLayerDefinition = {
  sourceKey: string;
  countries: UkCountry[];
  layers: LayerDefinition[];
  informationClass?: InformationClass;
  /** Polygon layers that only describe an area of interest (for example flood zones) report "covered" when imported. */
};

/**
 * Builds a provider over imported reference layers. Results only come from
 * active dataset versions; an unimported layer reports "not configured", never
 * "no record found".
 */
export type ReferenceLayerProvider = IntelligenceProvider & { definition: ReferenceLayerDefinition };

export function referenceLayerProvider(definition: ReferenceLayerDefinition): ReferenceLayerProvider {
  const nearbyCategory = (layer: LayerDefinition) => `${layer.category}_nearby`;
  const categories = definition.layers.flatMap((layer) => layer.nearbyMetres ? [layer.category, nearbyCategory(layer)] : [layer.category]);
  return {
    key: definition.sourceKey,
    definition,
    categories,
    applicability(location, context) {
      if (!location.country || !definition.countries.includes(location.country)) return { ok: false, status: "unsupported", message: location.country ? "This source does not cover the property's country." : "Set the property's country to check this source.", coverage: location.country ? "not_covered" : "unknown" };
      if (!context.spatial) return { ok: false, status: "not_configured", message: "Reference data is not available in this environment.", coverage: "unknown" };
      return requiresPreciseLocation(location) ?? { ok: true };
    },
    async run(location, context) {
      const layers = await context.spatial!.featuresAt({ sourceKey: definition.sourceKey, layers: definition.layers.map((layer) => layer.layer), latitude: location.latitude!, longitude: location.longitude!, nearbyMetres: Math.max(0, ...definition.layers.map((layer) => layer.nearbyMetres ?? 0)) });
      return definition.layers.flatMap((layer) => {
        const found = layers.find((item) => item.layer === layer.layer);
        const base = { now: context.now, informationClass: definition.informationClass, datasetVersion: found?.datasetVersion ?? null };
        if (!found?.available) {
          const notImported = result(definition.sourceKey, { ...base, category: layer.category, status: "not_configured", coverage: "unknown", message: `${layer.label} data has not been imported for this environment, so this was not checked.` });
          return layer.nearbyMetres ? [notImported, { ...notImported, category: nearbyCategory(layer) }] : [notImported];
        }
        const toRecord = (feature: (typeof found.features)[number], matchMethod: ProviderRecord["matchMethod"]): ProviderRecord => ({
          sourceRecordId: feature.featureId,
          category: matchMethod === "point_in_polygon" ? layer.category : nearbyCategory(layer),
          data: { layer: layer.layer, label: layer.label, name: feature.name, attributes: feature.attributes, distanceMetres: Math.round(feature.distanceMetres) },
          evidence: layer.evidenceUrl?.(feature.featureId, feature.attributes) ? [{ label: `${layer.label} record`, url: layer.evidenceUrl(feature.featureId, feature.attributes)! }] : [],
          matchMethod,
          confidence: matchMethod === "point_in_polygon" ? confidenceForLocation(location) : "low",
          sourceUpdatedAt: found.sourceUpdatedAt,
        });
        const intersecting = found.features.filter((feature) => feature.intersects).map((feature) => toRecord(feature, "point_in_polygon"));
        const main = intersecting.length
          ? result(definition.sourceKey, { ...base, category: layer.category, status: "matched", records: intersecting, coverage: "covered", message: layer.caveat })
          : result(definition.sourceKey, { ...base, category: layer.category, status: "no_match", coverage: "covered", message: `No ${layer.label.toLowerCase()} record intersects the recorded location in the imported data. ${layer.caveat}` });
        if (!layer.nearbyMetres) return [main];
        const nearby = found.features.filter((feature) => !feature.intersects && feature.distanceMetres <= layer.nearbyMetres!).map((feature) => toRecord(feature, "point_within_distance"));
        return [main, nearby.length
          ? result(definition.sourceKey, { ...base, category: nearbyCategory(layer), status: "matched", records: nearby, coverage: "covered", informationClass: "indicative_external", message: `Within ${layer.nearbyMetres} m of the recorded location. Nearby context only, not a match for this property.` })
          : result(definition.sourceKey, { ...base, category: nearbyCategory(layer), status: "no_match", coverage: "covered", informationClass: "indicative_external", message: `No ${layer.label.toLowerCase()} records within ${layer.nearbyMetres} m in the imported data.` })];
      });
    },
  };
}

const nhleEntry = (featureId: string, attributes: Record<string, unknown>) => {
  const entry = String(attributes.ListEntry ?? attributes.list_entry ?? featureId).replace(/\D/g, "");
  return entry ? `https://historicengland.org.uk/listing/the-list/list-entry/${entry}` : null;
};

export const historicEnglandProvider = referenceLayerProvider({
  sourceKey: "historic_england_nhle",
  countries: ["ENG"],
  layers: [
    { layer: "listed_building", category: "listed_building_nhle", label: "Listed building", nearbyMetres: 50, caveat: "Listing outlines are indicative; the list entry is the legal description.", evidenceUrl: nhleEntry },
    { layer: "scheduled_monument", category: "scheduled_monument_nhle", label: "Scheduled monument", caveat: "Check the list entry for the protected extent.", evidenceUrl: nhleEntry },
    { layer: "registered_park_garden", category: "registered_park_garden_nhle", label: "Registered park and garden", caveat: "Check the list entry for the registered area.", evidenceUrl: nhleEntry },
    { layer: "registered_battlefield", category: "registered_battlefield_nhle", label: "Registered battlefield", caveat: "Check the list entry for the registered area.", evidenceUrl: nhleEntry },
    { layer: "world_heritage_site", category: "world_heritage_site_nhle", label: "World Heritage Site", caveat: "Check the World Heritage Site boundary and buffer zone with the local authority.", evidenceUrl: nhleEntry },
  ],
});

// Land and environmental context (P3). Each layer must be imported and the
// source enabled after verification; otherwise it reports "not checked".

export const inspireProvider = referenceLayerProvider({
  sourceKey: "hmlr_inspire",
  countries: ["ENG", "WLS"],
  informationClass: "indicative_external",
  layers: [
    { layer: "index_polygons", category: "inspire_indicative_extent", label: "Registered freehold (indicative extent)", caveat: "Indicative registered extent: not a legal title boundary, ownership record or title search. Leasehold titles are not shown.", evidenceUrl: () => "https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions" },
  ],
});

export const floodZonesProvider = referenceLayerProvider({
  sourceKey: "ea_flood_zones",
  countries: ["ENG"],
  layers: [
    { layer: "flood_zone_3", category: "planning_flood_zone_3", label: "Flood Zone 3 (planning)", caveat: "Planning flood zone, not a property flood risk assessment. Defences and surface water are not reflected." },
    { layer: "flood_zone_2", category: "planning_flood_zone_2", label: "Flood Zone 2 (planning)", caveat: "Planning flood zone, not a property flood risk assessment. Not intersecting a zone is not proof of no flood risk." },
  ],
});

export const surfaceWaterProvider = referenceLayerProvider({
  sourceKey: "ea_rofsw",
  countries: ["ENG"],
  informationClass: "indicative_external",
  layers: [
    { layer: "rofsw_high", category: "surface_water_high", label: "Surface water flood risk: high", caveat: "Modelled surface water risk; kept separate from planning zones and river or sea risk." },
    { layer: "rofsw_medium", category: "surface_water_medium", label: "Surface water flood risk: medium", caveat: "Modelled surface water risk; kept separate from planning zones and river or sea risk." },
    { layer: "rofsw_low", category: "surface_water_low", label: "Surface water flood risk: low", caveat: "Modelled surface water risk; kept separate from planning zones and river or sea risk." },
  ],
});

export const geologyProvider = referenceLayerProvider({
  sourceKey: "bgs_geology_625k",
  countries: ["ENG", "WLS", "SCT"],
  informationClass: "indicative_external",
  layers: [
    { layer: "bedrock", category: "bedrock_geology", label: "Bedrock geology (1:625 000)", caveat: "Mapped geology at a regional scale requires interpretation. It is not a site investigation and says nothing about structural safety." },
    { layer: "superficial", category: "superficial_deposits", label: "Superficial deposits (1:625 000)", caveat: "Regional-scale mapping; absence of a mapped deposit is not proof of absence on site." },
  ],
});

export const naturalEnglandProvider = referenceLayerProvider({
  sourceKey: "ne_designations",
  countries: ["ENG"],
  layers: [
    { layer: "sssi", category: "sssi", label: "Site of Special Scientific Interest", nearbyMetres: 250, caveat: "Check Natural England's citation and any consultation requirements." },
    { layer: "sac", category: "special_area_of_conservation", label: "Special Area of Conservation", caveat: "Check the designation documents." },
    { layer: "spa", category: "special_protection_area", label: "Special Protection Area", caveat: "Check the designation documents." },
    { layer: "ramsar", category: "ramsar_site", label: "Ramsar site", caveat: "Check the designation documents." },
    { layer: "national_landscape", category: "national_landscape", label: "National Landscape", caveat: "Planning policy applies; check with the local planning authority." },
    { layer: "national_park", category: "national_park", label: "National Park", caveat: "The National Park Authority is the planning authority." },
    { layer: "ancient_woodland", category: "ancient_woodland", label: "Ancient woodland", nearbyMetres: 50, caveat: "The inventory is indicative and incomplete for small sites." },
  ],
});

// Country-specific layers (P6). Each nation's own publisher only, with its own
// categories, so an England result can never stand in for Wales, Scotland or
// Northern Ireland. Each source stays disabled until verified and imported.

export const nrwFloodZonesProvider = referenceLayerProvider({
  sourceKey: "nrw_flood_map_planning",
  countries: ["WLS"],
  layers: [
    { layer: "flood_zone_3", category: "wales_flood_zone_3", label: "Flood Zone 3 (Wales, planning)", caveat: "Natural Resources Wales planning flood zone, not a property flood risk assessment. Check which sources (rivers, sea, surface water) the imported layer combines." },
    { layer: "flood_zone_2", category: "wales_flood_zone_2", label: "Flood Zone 2 (Wales, planning)", caveat: "Planning flood zone; not intersecting is not proof of no flood risk." },
  ],
});

export const cadwProvider = referenceLayerProvider({
  sourceKey: "cadw_listed_buildings",
  countries: ["WLS"],
  layers: [
    { layer: "listed_building", category: "listed_building_cadw", label: "Listed building (Cadw)", nearbyMetres: 50, caveat: "Listing locations are indicative; the Cadw record is the legal description." },
  ],
});

export const hesProvider = referenceLayerProvider({
  sourceKey: "hes_designations",
  countries: ["SCT"],
  layers: [
    { layer: "listed_building", category: "listed_building_hes", label: "Listed building (Historic Environment Scotland)", nearbyMetres: 50, caveat: "Check the designation record for the listed extent and category." },
    { layer: "scheduled_monument", category: "scheduled_monument_hes", label: "Scheduled monument (Scotland)", caveat: "Check the designation record for the protected extent." },
    { layer: "conservation_area", category: "conservation_area_hes", label: "Conservation area (Scotland)", caveat: "Confirm with the local planning authority." },
    { layer: "garden_designed_landscape", category: "garden_designed_landscape_hes", label: "Garden and designed landscape", caveat: "Check the inventory record." },
    { layer: "battlefield", category: "battlefield_hes", label: "Inventory battlefield", caveat: "Check the inventory record." },
    { layer: "world_heritage_site", category: "world_heritage_site_hes", label: "World Heritage Site (Scotland)", caveat: "Check the boundary and buffer zone with the authority." },
  ],
});

const sepaLayers = (["river", "coastal", "surface_water"] as const).flatMap((type) => (["high", "medium", "low"] as const).map((likelihood) => ({
  layer: `${type}_${likelihood}`,
  category: `sepa_${type}_${likelihood}`,
  label: `SEPA ${type.replace("_", " ")} flood likelihood: ${likelihood}`,
  caveat: "Modelled likelihood at a strategic scale; not a property flood risk assessment. Not intersecting is not proof of no flood risk.",
})));

export const sepaFloodProvider = referenceLayerProvider({
  sourceKey: "sepa_flood_maps",
  countries: ["SCT"],
  informationClass: "indicative_external",
  layers: sepaLayers,
});

export const niHedProvider = referenceLayerProvider({
  sourceKey: "ni_hed_listed_buildings",
  countries: ["NIR"],
  layers: [
    { layer: "listed_building", category: "listed_building_ni_hed", label: "Listed building (Northern Ireland)", nearbyMetres: 50, caveat: "Check the Historic Environment Division record for the listed extent and grade." },
  ],
});
