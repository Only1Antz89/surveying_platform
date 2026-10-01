"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type FeatureCollection = { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> };

const colourExpression: ExpressionSpecification = ["match", ["get", "sourceKey"], "hmlr_inspire", "#dc2626", "historic_england", "#7c3aed", "planning_data", "#2563eb", "ea_flood_zone_2", "#60a5fa", "ea_flood_zone_3", "#1d4ed8", "#3b82f6"];

export function PropertyMap({ propertyId, latitude, longitude }: { propertyId: string; latitude: number; longitude: number }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors";
  const configurationError = !styleUrl && process.env.NODE_ENV === "production" ? "A production map provider has not been configured." : null;

  useEffect(() => {
    if (!container.current || mapRef.current || configurationError) return;
    const style = styleUrl || {
      version: 8 as const,
      sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution } },
      layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
    };
    const map = new maplibregl.Map({ container: container.current, style, center: [longitude, latitude], zoom: 17, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ customAttribution: attribution, compact: true }));
    mapRef.current = map;
    map.on("load", async () => {
      try {
        const response = await fetch(`/api/v1/properties/${propertyId}/intelligence/map`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? "Map context could not be loaded.");
        const collection = payload.data as FeatureCollection;
        map.addSource("property-intelligence", { type: "geojson", data: collection as never });
        map.addLayer({ id: "intelligence-fills", type: "fill", source: "property-intelligence", filter: ["!=", ["geometry-type"], "Point"], paint: { "fill-color": colourExpression, "fill-opacity": 0.25 } });
        map.addLayer({ id: "intelligence-lines", type: "line", source: "property-intelligence", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": colourExpression, "line-width": 2 } });
        map.addLayer({ id: "property-point", type: "circle", source: "property-intelligence", filter: ["==", ["get", "sourceKey"], "property"], paint: { "circle-radius": 7, "circle-color": "#0f1b2d", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Map context could not be loaded.");
      }
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [attribution, configurationError, latitude, longitude, propertyId, styleUrl]);

  const visibleError = error ?? configurationError;
  return <div className="property-map-shell">{visibleError ? <div className="map-empty"><strong>Map unavailable</strong><span>{visibleError}</span></div> : <div ref={container} className="property-map" aria-label="Property and contextual data map" />}</div>;
}
