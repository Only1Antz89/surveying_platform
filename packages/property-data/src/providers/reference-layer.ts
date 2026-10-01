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
export function referenceLayerProvider(definition: ReferenceLayerDefinition): IntelligenceProvider {
  const nearbyCategory = (layer: LayerDefinition) => `${layer.category}_nearby`;
  const categories = definition.layers.flatMap((layer) => layer.nearbyMetres ? [layer.category, nearbyCategory(layer)] : [layer.category]);
  return {
    key: definition.sourceKey,
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
