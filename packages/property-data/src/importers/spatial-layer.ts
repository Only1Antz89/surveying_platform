import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { eq, sql } from "drizzle-orm";
import { referenceDatasetSyncs, type Database } from "@surveynt/db";
import { getSourceDefinition } from "../registry/sources";
import { activateSync } from "../db/reference";
import { sha256File, type ImportOutcome } from "./os-open-uprn";

export type LayerPreset = { idProperty: string; nameProperty?: string; keepProperties: string[] };

// Attribute allowlists per layer. Only listed attributes are stored, so
// restricted fields (for example addresses) are never copied. Property names
// must be confirmed against each downloaded release before import.
export const layerPresets: Record<string, LayerPreset> = {
  "historic_england_nhle:listed_building": { idProperty: "ListEntry", nameProperty: "Name", keepProperties: ["ListEntry", "Name", "Grade", "ListDate", "AmendDate"] },
  "historic_england_nhle:scheduled_monument": { idProperty: "ListEntry", nameProperty: "Name", keepProperties: ["ListEntry", "Name", "SchedDate", "AmendDate"] },
  "historic_england_nhle:registered_park_garden": { idProperty: "ListEntry", nameProperty: "Name", keepProperties: ["ListEntry", "Name", "Grade", "RegDate", "AmendDate"] },
  "historic_england_nhle:registered_battlefield": { idProperty: "ListEntry", nameProperty: "Name", keepProperties: ["ListEntry", "Name", "RegDate", "AmendDate"] },
  "historic_england_nhle:world_heritage_site": { idProperty: "ListEntry", nameProperty: "Name", keepProperties: ["ListEntry", "Name", "InscrDate"] },
  // INSPIRE polygons: keep the INSPIRE id only. No title or owner data is stored.
  "hmlr_inspire:index_polygons": { idProperty: "INSPIREID", keepProperties: ["INSPIREID"] },
  "ea_flood_zones:flood_zone_2": { idProperty: "fid", keepProperties: ["flood_zone", "type"] },
  "ea_flood_zones:flood_zone_3": { idProperty: "fid", keepProperties: ["flood_zone", "type"] },
  "ea_rofsw:rofsw_high": { idProperty: "fid", keepProperties: ["risk_band"] },
  "ea_rofsw:rofsw_medium": { idProperty: "fid", keepProperties: ["risk_band"] },
  "ea_rofsw:rofsw_low": { idProperty: "fid", keepProperties: ["risk_band"] },
  "bgs_geology_625k:bedrock": { idProperty: "fid", nameProperty: "LEX_RCS_D", keepProperties: ["LEX_D", "RCS_D", "LEX_RCS_D", "MAX_PERIOD", "MIN_PERIOD"] },
  "bgs_geology_625k:superficial": { idProperty: "fid", nameProperty: "LEX_RCS_D", keepProperties: ["LEX_D", "RCS_D", "LEX_RCS_D"] },
  "ne_designations:sssi": { idProperty: "ref_code", nameProperty: "name", keepProperties: ["name", "ref_code"] },
  "ne_designations:sac": { idProperty: "code", nameProperty: "name", keepProperties: ["name", "code"] },
  "ne_designations:spa": { idProperty: "code", nameProperty: "name", keepProperties: ["name", "code"] },
  "ne_designations:ramsar": { idProperty: "code", nameProperty: "name", keepProperties: ["name", "code"] },
  "ne_designations:national_landscape": { idProperty: "code", nameProperty: "name", keepProperties: ["name", "code"] },
  "ne_designations:national_park": { idProperty: "code", nameProperty: "name", keepProperties: ["name", "code"] },
  "ne_designations:ancient_woodland": { idProperty: "fid", nameProperty: "name", keepProperties: ["name", "themname"] },
  // Country-specific layers (P6). Field names are provisional: confirm against each download and override with --id-property/--attributes.
  "nrw_flood_map_planning:flood_zone_2": { idProperty: "fid", keepProperties: ["flood_zone", "source"] },
  "nrw_flood_map_planning:flood_zone_3": { idProperty: "fid", keepProperties: ["flood_zone", "source"] },
  "cadw_listed_buildings:listed_building": { idProperty: "RecordNumber", nameProperty: "Name", keepProperties: ["RecordNumber", "Name", "Grade"] },
  "hes_designations:listed_building": { idProperty: "DES_REF", nameProperty: "DES_TITLE", keepProperties: ["DES_REF", "DES_TITLE", "CATEGORY"] },
  "hes_designations:scheduled_monument": { idProperty: "DES_REF", nameProperty: "DES_TITLE", keepProperties: ["DES_REF", "DES_TITLE"] },
  "hes_designations:conservation_area": { idProperty: "DES_REF", nameProperty: "DES_TITLE", keepProperties: ["DES_REF", "DES_TITLE"] },
  "hes_designations:garden_designed_landscape": { idProperty: "DES_REF", nameProperty: "DES_TITLE", keepProperties: ["DES_REF", "DES_TITLE"] },
  "hes_designations:battlefield": { idProperty: "DES_REF", nameProperty: "DES_TITLE", keepProperties: ["DES_REF", "DES_TITLE"] },
  "hes_designations:world_heritage_site": { idProperty: "DES_REF", nameProperty: "DES_TITLE", keepProperties: ["DES_REF", "DES_TITLE"] },
  "ni_hed_listed_buildings:listed_building": { idProperty: "HB_NUMBER", keepProperties: ["HB_NUMBER", "GRADE"] },
  "sepa_flood_maps:river_high": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:river_medium": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:river_low": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:coastal_high": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:coastal_medium": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:coastal_low": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:surface_water_high": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:surface_water_medium": { idProperty: "fid", keepProperties: ["likelihood"] },
  "sepa_flood_maps:surface_water_low": { idProperty: "fid", keepProperties: ["likelihood"] },
};

export type SpatialLayerImportOptions = {
  sourceKey: string;
  layer: string;
  filePath: string;
  datasetVersion: string;
  sourceUrl?: string;
  sourceCrs?: string;
  preset?: LayerPreset;
  activate?: boolean;
  importedBy: string;
  batchSize?: number;
};

type ParsedFeature = { id: string; name: string | null; attributes: Record<string, unknown>; geometry: string };

const allowedGeometry = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"]);

async function* features(filePath: string): AsyncGenerator<Record<string, unknown>> {
  const handle = await open(filePath);
  const { buffer, bytesRead } = await handle.read(Buffer.alloc(512), 0, 512, 0);
  await handle.close();
  const head = buffer.subarray(0, bytesRead).toString("utf8");
  if (/"type"\s*:\s*"FeatureCollection"/.test(head)) {
    // Small FeatureCollection files (tests, regional extracts). Large files should be GeoJSONSeq.
    const collection = JSON.parse(await readFile(filePath, "utf8")) as { features?: Record<string, unknown>[] };
    for (const feature of collection.features ?? []) yield feature;
    return;
  }
  for await (const raw of createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })) {
    const line = raw.replace(/^\u001e/, "").trim();
    if (line) yield JSON.parse(line) as Record<string, unknown>;
  }
}

/**
 * Imports one layer from GeoJSON (or line-delimited GeoJSONSeq) already
 * reprojected to EPSG:4326, for example:
 *   ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 listed.geojsonl Listed_Building_polygons.shp
 * Rows load under a new staged version; validation failures never touch the active version.
 */
export async function importSpatialLayer(db: Database, options: SpatialLayerImportOptions): Promise<ImportOutcome> {
  const definition = getSourceDefinition(options.sourceKey);
  if (!definition) throw new Error(`${options.sourceKey} is not registered.`);
  if (definition.registerStatus === "blocked") throw new Error(`${options.sourceKey} is blocked in the source register and cannot be imported.`);
  const preset = options.preset ?? layerPresets[`${options.sourceKey}:${options.layer}`];
  if (!preset) throw new Error(`No attribute allowlist is defined for ${options.sourceKey}:${options.layer}.`);
  const checksum = await sha256File(options.filePath);
  const [sync] = await db.insert(referenceDatasetSyncs).values({
    sourceKey: options.sourceKey, layer: options.layer, datasetVersion: options.datasetVersion, sourceUrl: options.sourceUrl ?? definition.accessUrls[0] ?? null, checksum,
    licence: definition.licence as unknown as Record<string, unknown>, sourceCrs: options.sourceCrs ?? "converted to EPSG:4326 before import", extent: "file", importedBy: options.importedBy,
  }).returning();
  let skipped = 0;
  try {
    let batch: ParsedFeature[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await db.execute(sql`
        insert into reference.spatial_features (dataset_sync_id, source_key, layer, feature_id, name, attributes, geom)
        select ${sync.id}::uuid, ${options.sourceKey}, ${options.layer}, t.id, t.name, t.attrs::jsonb, st_makevalid(st_setsrid(st_geomfromgeojson(t.geom), 4326))
        from unnest(${sql.param(batch.map((item) => item.id))}::text[], ${sql.param(batch.map((item) => item.name))}::text[], ${sql.param(batch.map((item) => JSON.stringify(item.attributes)))}::text[], ${sql.param(batch.map((item) => item.geometry))}::text[]) as t(id, name, attrs, geom)
        on conflict do nothing`);
      batch = [];
    };
    for await (const feature of features(options.filePath)) {
      const geometry = feature.geometry as { type?: string } | null;
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const id = properties[preset.idProperty] ?? feature.id;
      if (!geometry?.type || !allowedGeometry.has(geometry.type) || id === undefined || id === null || String(id).trim() === "") { skipped += 1; continue; }
      batch.push({
        id: String(id).slice(0, 200),
        name: preset.nameProperty && properties[preset.nameProperty] !== undefined ? String(properties[preset.nameProperty]).slice(0, 500) : null,
        attributes: Object.fromEntries(preset.keepProperties.filter((key) => key in properties).map((key) => [key, properties[key]])),
        geometry: JSON.stringify(geometry),
      });
      if (batch.length >= (options.batchSize ?? 1000)) await flush();
    }
    await flush();
    const checks = await db.execute(sql`
      select count(*)::int as stored,
        count(*) filter (where not st_isvalid(geom))::int as invalid,
        count(*) filter (where st_xmin(geom) < -9.5 or st_xmax(geom) > 2.5 or st_ymin(geom) < 49 or st_ymax(geom) > 61.5)::int as outside
      from reference.spatial_features where dataset_sync_id = ${sync.id}`);
    const counts = (checks as unknown as { rows: { stored: number; invalid: number; outside: number }[] }).rows[0];
    const validation = { storedRows: counts.stored, skippedRows: skipped, invalidGeometries: counts.invalid, outsideUkExtent: counts.outside };
    if (counts.stored === 0) throw Object.assign(new Error("No usable features were found. Check the identifier property and geometry."), { validation });
    if (counts.outside > 0) throw Object.assign(new Error(`${counts.outside} features fall outside the UK extent. Reproject the source to EPSG:4326 before importing.`), { validation });
    if (counts.invalid > 0) throw Object.assign(new Error(`${counts.invalid} geometries are invalid after repair.`), { validation });
    await db.update(referenceDatasetSyncs).set({ recordCount: counts.stored, validation, completedAt: new Date() }).where(eq(referenceDatasetSyncs.id, sync.id));
    if (options.activate) await activateSync(db, sync.id);
    return { syncId: sync.id, status: options.activate ? "active" : "staging", recordCount: counts.stored, skipped, validation };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message.slice(0, 1000) : "Import failed.";
    const validation = (reason as { validation?: Record<string, unknown> }).validation ?? { skippedRows: skipped };
    await db.execute(sql`delete from reference.spatial_features where dataset_sync_id = ${sync.id}`);
    await db.update(referenceDatasetSyncs).set({ status: "failed", error: message, validation, completedAt: new Date() }).where(eq(referenceDatasetSyncs.id, sync.id));
    return { syncId: sync.id, status: "failed", recordCount: 0, skipped, validation, error: message };
  }
}
