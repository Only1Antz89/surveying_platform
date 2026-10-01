"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layers } from "lucide-react";
import type { PropertyMapView } from "@/lib/property-map";

const palette = ["#2563eb", "#b45309", "#7c3aed", "#0f766e", "#be123c", "#4d7c0f", "#0369a1", "#a16207"];
const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
const basemapAttribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION;

/**
 * MapLibre view of imported reference layers. The basemap is configurable; without one, data layers are drawn on
 * a plain background (public OSM tile servers are not used for production traffic). Every visible layer is attributed.
 */
export function PropertyMap({ propertyId }: { propertyId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PropertyMapView | null>(null);
  const [demo, setDemo] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [mapError, setMapError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/properties/${propertyId}/map`, { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) return setLoadError(payload?.error?.message ?? "Map data is unavailable.");
        setView(payload.data); setDemo(Boolean(payload.meta?.demo));
      })
      .catch(() => { if (!cancelled) setLoadError("Map data is unavailable while offline."); });
    return () => { cancelled = true; };
  }, [propertyId]);

  useEffect(() => {
    if (!view?.point || !container.current) return;
    let disposed = false;
    const point = view.point;
    (async () => {
      try {
        const { Map, Marker, getVersion, setWorkerUrl } = await import("maplibre-gl");
        // Served from public/ by scripts/copy-maplibre-worker.mjs; the bundle cannot locate the worker itself.
        setWorkerUrl(`/vendor/maplibre-gl/${getVersion()}/maplibre-gl-worker.mjs`);
        if (disposed || !container.current) return;
        const attributions = [...new Set([basemapAttribution, ...view.layers.map((layer) => layer.attribution)].filter((item): item is string => Boolean(item)))];
        const map = new Map({
          container: container.current,
          style: styleUrl ?? { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef2f7" } }] },
          center: [point.longitude, point.latitude],
          zoom: 17,
          attributionControl: { compact: false, customAttribution: attributions },
        });
        mapRef.current = map;
        map.on("error", () => setMapError("Part of the map could not be loaded. Findings are still listed below."));
        map.on("load", () => {
          view.layers.forEach((layer, index) => {
            const colour = palette[index % palette.length];
            map.addSource(layer.id, { type: "geojson", data: layer.featureCollection as never });
            map.addLayer({ id: `${layer.id}:fill`, type: "fill", source: layer.id, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": colour, "fill-opacity": 0.18 } });
            map.addLayer({ id: `${layer.id}:line`, type: "line", source: layer.id, paint: { "line-color": colour, "line-width": 2 } });
            map.addLayer({ id: `${layer.id}:point`, type: "circle", source: layer.id, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": colour, "circle-radius": 5 } });
          });
        });
        new Marker({ color: point.confidence === "surveyor_confirmed" ? "#15825e" : "#a76209" }).setLngLat([point.longitude, point.latitude]).addTo(map);
      } catch {
        setMapError("The interactive map is not supported on this device. Findings are listed below.");
      }
    })();
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  }, [view]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !view) return;
    for (const layer of view.layers) for (const suffix of ["fill", "line", "point"]) if (map.getLayer(`${layer.id}:${suffix}`)) map.setLayoutProperty(`${layer.id}:${suffix}`, "visibility", hidden[layer.id] ? "none" : "visible");
  }, [hidden, view]);

  if (loadError) return <section className="panel"><div className="empty-state"><strong>{loadError}</strong></div></section>;
  if (!view) return <section className="panel"><div className="empty-state"><strong>Loading map…</strong></div></section>;
  if (!view.point) return <section className="panel"><div className="empty-state"><strong>No location yet</strong><span>Resolve the property location on the Overview tab to show the map.</span></div></section>;

  return <section className="panel map-panel" aria-labelledby="map-heading">
    <div className="panel-header"><div><h2 id="map-heading">Land and map</h2><p>{view.point.confidence === "surveyor_confirmed" ? "Surveyor-confirmed location." : "Approximate location: confirm it before relying on spatial results."}</p></div><Layers size={17} color="#3b82f6" aria-hidden="true" /></div>
    {demo ? <p className="address-demo-label intel-inline">Demo workspace: one invented shape for illustration. No real reference layers are loaded.</p> : null}
    {!styleUrl ? <p className="identity-warning">Basemap not configured. Data layers are drawn on a plain background until a licensed tile provider is set.</p> : null}
    {mapError ? <p className="identity-warning">{mapError}</p> : null}
    <div ref={container} className="property-map" role="img" aria-label="Map of the property location and imported reference layers. The same findings are listed in the panels below." />
    <div className="map-legend">
      {view.layers.length ? view.layers.map((layer, index) => <label key={layer.id} className="map-legend-item"><input type="checkbox" checked={!hidden[layer.id]} onChange={(event) => setHidden({ ...hidden, [layer.id]: !event.target.checked })} /><i style={{ background: palette[index % palette.length] }} aria-hidden="true" /><span><strong>{layer.label}</strong><span className="cell-sub">{layer.featureCollection.features.length} feature{layer.featureCollection.features.length === 1 ? "" : "s"} within 300 m · dataset {layer.datasetVersion}</span><span className="cell-sub">{layer.caveat}</span></span></label>) : <p className="form-help">No reference layers are available to draw here.</p>}
      {view.notChecked.length ? <p className="form-help">Not checked: {view.notChecked.map((item) => `${item.label} (${item.reason})`).join("; ")}.</p> : null}
    </div>
  </section>;
}
