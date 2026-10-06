import { and, eq } from "drizzle-orm";
import { createDatabase, properties, withTenant } from "@surveynt/db";
import { ukCountryLabels } from "@surveynt/domain";
import { getSourceDefinition, licenceFor, mapLayerProviders, sourceCoversCountry } from "@surveynt/property-data";
import { featuresNear, getSourceStates } from "@surveynt/property-data/importers";
import { isDemoOrganisation } from "./stakeholder-demo";

export type MapLayerView = {
  id: string;
  sourceKey: string;
  layer: string;
  label: string;
  caveat: string;
  attribution: string;
  datasetVersion: string;
  featureCollection: { type: "FeatureCollection"; features: { type: "Feature"; id: string; properties: Record<string, unknown>; geometry: Record<string, unknown> }[] };
};

export type PropertyMapView = {
  point: { latitude: number; longitude: number; confidence: string } | null;
  layers: MapLayerView[];
  notChecked: { label: string; reason: string }[];
};

/** Reference layers around the property for display. Only enabled sources, covered countries and imported layers appear. */
export async function loadPropertyMap(context: { organisationId: string }, propertyId: string): Promise<PropertyMapView | null> {
  const db = createDatabase();
  const [property] = await withTenant(db, context.organisationId, (tx) => tx.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.organisationId, context.organisationId))).limit(1));
  if (!property) return null;
  if (property.latitude === null || property.longitude === null) return { point: null, layers: [], notChecked: [] };
  const point = { latitude: property.latitude, longitude: property.longitude, confidence: property.locationConfidence };
  if(await isDemoOrganisation(context.organisationId,db))return {point,layers:[],notChecked:[{label:"Demonstration layers",reason:"Fictional property. No live heritage, title or flood assessment is represented; refresh intelligence to exercise labelled simulated outcomes."}]};
  if (!property.country) return { point, layers: [], notChecked: [{ label: "All reference layers", reason: "Set the property's country" }] };
  const enabled = await getSourceStates(db, mapLayerProviders.map((provider) => provider.key));
  const layers: MapLayerView[] = [];
  const notChecked: PropertyMapView["notChecked"] = [];
  for (const provider of mapLayerProviders) {
    const source = getSourceDefinition(provider.key);
    for (const layer of provider.definition.layers) {
      if (!source) continue;
      if (!sourceCoversCountry(source, property.country)) { notChecked.push({ label: layer.label, reason: `No coverage in ${ukCountryLabels[property.country]}` }); continue; }
      if (!enabled[provider.key]) { notChecked.push({ label: layer.label, reason: "Source not enabled" }); continue; }
      const found = await featuresNear(db, { sourceKey: provider.key, layer: layer.layer, latitude: property.latitude, longitude: property.longitude, radiusMetres: 300 });
      if (!found) { notChecked.push({ label: layer.label, reason: "Not imported" }); continue; }
      layers.push({ id: `${provider.key}:${layer.layer}`, sourceKey: provider.key, layer: layer.layer, label: layer.label, caveat: layer.caveat, attribution: licenceFor(provider.key).attribution.replace(/\{year\}/g, String(new Date().getFullYear())), datasetVersion: found.datasetVersion, featureCollection: found.featureCollection });
    }
  }
  return { point, layers, notChecked };
}

/** Labelled development demo: one invented polygon so the map can be exercised without reference data. */
export const demoPropertyMap: PropertyMapView = {
  point: { latitude: 51.4544, longitude: -2.6198, confidence: "geocoded_address" },
  layers: [{
    id: "demo:illustrative_area",
    sourceKey: "demo",
    layer: "illustrative_area",
    label: "DEMO illustrative area",
    caveat: "Invented shape for the demo workspace. It is not flood, title or designation data.",
    attribution: "Demo data (not a real dataset)",
    datasetVersion: "demo",
    featureCollection: { type: "FeatureCollection", features: [{ type: "Feature", id: "demo-1", properties: { name: "DEMO illustrative area" }, geometry: { type: "Polygon", coordinates: [[[-2.6206, 51.4539], [-2.619, 51.4539], [-2.619, 51.4549], [-2.6206, 51.4549], [-2.6206, 51.4539]]] } }] },
  }],
  notChecked: [{ label: "All real reference layers", reason: "Demo workspace" }],
};
