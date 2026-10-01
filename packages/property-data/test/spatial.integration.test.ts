import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { datasetSyncs } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import type { PropertyLocation } from "../src/contract";
import { syncSourceRegistry } from "../src/db/reference";
import { databaseSpatialQuery, featuresNear } from "../src/db/spatial";
import { importSpatialLayer } from "../src/importers/spatial-layer";
import { floodZonesProvider, inspireProvider } from "../src/providers/reference-layer";

// Synthetic layers with known geometry (not real flood or title data).
// FZ3: square 51.450–51.452 N, -2.602 to -2.600 E. FZ2: wider square around it. INSPIRE: one parcel.
const ring = (south: number, west: number, north: number, east: number) => [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
const collection = (features: { id: string; ring: number[][][]; extra?: Record<string, unknown> }[]) => JSON.stringify({ type: "FeatureCollection", features: features.map((feature) => ({ type: "Feature", properties: { fid: feature.id, INSPIREID: feature.id, flood_zone: "test", ...feature.extra }, geometry: { type: "Polygon", coordinates: feature.ring } })) });

const location = (latitude: number, longitude: number, overrides: Partial<PropertyLocation> = {}): PropertyLocation => ({ propertyId: "p", country: "ENG", uprn: null, latitude, longitude, locationConfidence: "surveyor_confirmed", postcode: null, ...overrides });

describe.skipIf(!integrationEnabled)("spatial reference layers", () => {
  let database: TestDatabase;
  let directory = "";

  const write = async (name: string, content: string) => {
    const file = path.join(directory, name);
    await writeFile(file, content);
    return file;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    directory = await mkdtemp(path.join(tmpdir(), "surveynt-spatial-"));
    await syncSourceRegistry(database.connect(database.adminUrl));
    const importer = database.connect(database.importerUrl);
    const fz3 = await importSpatialLayer(importer, { sourceKey: "ea_flood_zones", layer: "flood_zone_3", filePath: await write("fz3.geojson", collection([{ id: "fz3-1", ring: ring(51.45, -2.602, 51.452, -2.6) }])), datasetVersion: "synthetic-fz3", activate: true, importedBy: "test" });
    const fz2 = await importSpatialLayer(importer, { sourceKey: "ea_flood_zones", layer: "flood_zone_2", filePath: await write("fz2.geojson", collection([{ id: "fz2-1", ring: ring(51.449, -2.603, 51.453, -2.599) }])), datasetVersion: "synthetic-fz2", activate: true, importedBy: "test" });
    const inspire = await importSpatialLayer(importer, { sourceKey: "hmlr_inspire", layer: "index_polygons", filePath: await write("inspire.geojson", collection([{ id: "INSPIRE-TEST-1", ring: ring(51.4505, -2.6015, 51.4510, -2.6010), extra: { TITLE_NO: "should-not-be-stored" } }])), datasetVersion: "synthetic-inspire", activate: true, importedBy: "test" });
    expect([fz3.status, fz2.status, inspire.status]).toEqual(["active", "active", "active"]);
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  const run = async (provider: typeof floodZonesProvider, place: PropertyLocation) => {
    const db = database.connect(database.appUrl);
    const context = { now: new Date(), env: {}, spatial: databaseSpatialQuery(db) };
    const applicability = provider.applicability(place, context);
    if (!applicability.ok) return applicability;
    return Object.fromEntries((await provider.run(place, context)).map((item) => [item.category, item.status]));
  };

  it("returns known inside/outside/boundary answers", async () => {
    expect(await run(floodZonesProvider, location(51.451, -2.601))).toEqual({ planning_flood_zone_3: "matched", planning_flood_zone_2: "matched" });
    expect(await run(floodZonesProvider, location(51.4525, -2.6025))).toEqual({ planning_flood_zone_3: "no_match", planning_flood_zone_2: "matched" });
    expect(await run(floodZonesProvider, location(51.46, -2.61))).toEqual({ planning_flood_zone_3: "no_match", planning_flood_zone_2: "no_match" });
    expect(await run(floodZonesProvider, location(51.452, -2.601))).toMatchObject({ planning_flood_zone_3: "matched" });
  });

  it("labels INSPIRE results as indicative and stores only the INSPIRE id", async () => {
    const db = database.connect(database.appUrl);
    const results = await inspireProvider.run(location(51.4507, -2.6012), { now: new Date(), env: {}, spatial: databaseSpatialQuery(db) });
    expect(results[0]).toMatchObject({ status: "matched", informationClass: "indicative_external" });
    expect(results[0].records[0].data).toMatchObject({ attributes: { INSPIREID: "INSPIRE-TEST-1" } });
    expect(JSON.stringify(results)).not.toContain("should-not-be-stored");
    expect(results[0].message).toMatch(/not a legal title boundary/);
  });

  it("does not answer for unsupported countries or approximate points", async () => {
    expect(await run(floodZonesProvider, location(51.451, -2.601, { country: "WLS" }))).toMatchObject({ ok: false, status: "unsupported", coverage: "not_covered" });
    expect(await run(floodZonesProvider, location(51.451, -2.601, { locationConfidence: "postcode_centroid" }))).toMatchObject({ ok: false, status: "unsupported" });
  });

  it("keeps the active layer when a new import fails, and activates layers independently", async () => {
    const importer = database.connect(database.importerUrl);
    const failed = await importSpatialLayer(importer, { sourceKey: "ea_flood_zones", layer: "flood_zone_3", filePath: await write("bad.geojson", collection([{ id: "x", ring: ring(40.0, 10.0, 40.1, 10.1) }])), datasetVersion: "wrong-crs", activate: true, importedBy: "test" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/outside the UK/);
    const active = await importer.select().from(datasetSyncs).where(and(eq(datasetSyncs.sourceKey, "ea_flood_zones"), eq(datasetSyncs.status, "active")));
    expect(active.map((row) => `${row.layer}:${row.datasetVersion}`).sort()).toEqual(["flood_zone_2:synthetic-fz2", "flood_zone_3:synthetic-fz3"]);
    expect(await run(floodZonesProvider, location(51.451, -2.601))).toMatchObject({ planning_flood_zone_3: "matched" });
  });

  it("serves bounded, simplified features for the map", async () => {
    const db = database.connect(database.appUrl);
    const near = await featuresNear(db, { sourceKey: "ea_flood_zones", layer: "flood_zone_3", latitude: 51.451, longitude: -2.601, radiusMetres: 300 });
    expect(near?.featureCollection.features).toHaveLength(1);
    expect(near?.featureCollection.features[0].geometry).toMatchObject({ type: "Polygon" });
    expect(await featuresNear(db, { sourceKey: "ea_flood_zones", layer: "flood_zone_3", latitude: 51.5, longitude: -2.7, radiusMetres: 300 })).toMatchObject({ featureCollection: { features: [] } });
    expect(await featuresNear(db, { sourceKey: "ne_designations", layer: "sssi", latitude: 51.451, longitude: -2.601, radiusMetres: 300 })).toBeNull();
  });
});
