// Synthetic import and query benchmark for the runbook. Run against a local
// test database only:
//   TEST_DATABASE_URL=postgres://… pnpm --filter @surveynt/property-data benchmark
// All data is generated; nothing is downloaded.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { referenceDataSources } from "@surveynt/db";
import { createTestDatabase, stopRelay } from "@surveynt/db/testing";
import { databaseHistoryQuery } from "../src/db/history";
import { findUprnCandidates, syncSourceRegistry } from "../src/db/reference";
import { databaseSpatialQuery } from "../src/db/spatial";
import { importOsOpenUprn } from "../src/importers/os-open-uprn";
import { importPricePaid, importPricePaidUprnLookup } from "../src/importers/price-paid";
import { importSpatialLayer } from "../src/importers/spatial-layer";

const UPRNS = Number(process.env.BENCH_UPRNS ?? 200_000);
const POLYGONS = Number(process.env.BENCH_POLYGONS ?? 20_000);
const SALES = Number(process.env.BENCH_SALES ?? 200_000);
const QUERIES = 200;

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((p / 100) * values.length))];
const rate = (rows: number, ms: number) => Math.round(rows / (ms / 1000)).toLocaleString("en-GB");

async function timed<T>(work: () => Promise<T>) {
  const started = performance.now();
  const result = await work();
  return { result, ms: performance.now() - started };
}

const database = await createTestDatabase();
try {
  const admin = database.connect(database.adminUrl);
  const importer = database.connect(database.importerUrl);
  const app = database.connect(database.appUrl);
  await syncSourceRegistry(admin);
  await admin.update(referenceDataSources).set({ enabled: true, verifiedAt: new Date(), verifiedBy: "benchmark" }).where(sql`${referenceDataSources.key} = 'hmlr_ppd_uprn_lookup'`);
  const directory = await mkdtemp(path.join(tmpdir(), "surveynt-bench-"));
  const results: string[] = [];

  // OS Open UPRN: points in a Bristol-sized box, with BNG coordinates from PostGIS so the CRS cross-check passes.
  const points = await admin.execute(sql`
    select (990000000000 + n)::text as uprn, st_x(p) as lon, st_y(p) as lat, st_x(st_transform(p, 27700)) as x, st_y(st_transform(p, 27700)) as y
    from (select n, st_setsrid(st_makepoint(-2.70 + random() * 0.25, 51.40 + random() * 0.12), 4326) as p from generate_series(1, ${UPRNS}) as n) generated`);
  const uprnRows = (points as unknown as { rows: { uprn: string; lon: number; lat: number; x: number; y: number }[] }).rows;
  const uprnFile = path.join(directory, "uprn.csv");
  await writeFile(uprnFile, `UPRN,X_COORDINATE,Y_COORDINATE,LATITUDE,LONGITUDE\n${uprnRows.map((row) => `${row.uprn},${row.x.toFixed(2)},${row.y.toFixed(2)},${row.lat.toFixed(7)},${row.lon.toFixed(7)}`).join("\n")}\n`);
  const uprnImport = await timed(() => importOsOpenUprn(importer, { filePath: uprnFile, datasetVersion: "bench", activate: true, importedBy: "bench" }));
  results.push(`| OS Open UPRN import | ${UPRNS.toLocaleString("en-GB")} points | ${(uprnImport.ms / 1000).toFixed(1)} s | ${rate(UPRNS, uprnImport.ms)} rows/s | ${uprnImport.result.status} |`);

  // Spatial layer: small squares on a grid.
  const side = Math.ceil(Math.sqrt(POLYGONS));
  const features = Array.from({ length: POLYGONS }, (_, index) => {
    const lon = -2.70 + (index % side) * (0.25 / side);
    const lat = 51.40 + Math.floor(index / side) * (0.12 / side);
    const d = 0.25 / side / 3;
    return JSON.stringify({ type: "Feature", properties: { fid: `f${index}`, flood_zone: "3" }, geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] } });
  });
  const layerFile = path.join(directory, "layer.geojsonl");
  await writeFile(layerFile, `${features.join("\n")}\n`);
  const layerImport = await timed(() => importSpatialLayer(importer, { sourceKey: "ea_flood_zones", layer: "flood_zone_3", filePath: layerFile, datasetVersion: "bench", activate: true, importedBy: "bench" }));
  results.push(`| Spatial layer import | ${POLYGONS.toLocaleString("en-GB")} polygons | ${(layerImport.ms / 1000).toFixed(1)} s | ${rate(POLYGONS, layerImport.ms)} rows/s | ${layerImport.result.status} |`);

  // Price Paid full file, monthly update and look-up.
  const tid = (n: number) => `{8A1B2C3D-0000-4000-8000-${String(n).padStart(12, "0")}}`;
  const ppdLine = (n: number, status = "A") => [tid(n), String(100000 + (n % 900000)), `20${String(10 + (n % 15)).padStart(2, "0")}-0${1 + (n % 9)}-1${n % 9} 00:00`, "BS8 4JX", "T", "N", "F", "1", "", "SYNTHETIC", "", "TOWN", "DISTRICT", "COUNTY", "A", status].map((field) => `"${field}"`).join(",");
  const ppdFile = path.join(directory, "pp.csv");
  await writeFile(ppdFile, Array.from({ length: SALES }, (_, index) => ppdLine(index + 1)).join("\n"));
  const ppdImport = await timed(() => importPricePaid(importer, { filePath: ppdFile, datasetVersion: "2026-08", mode: "full", activate: true, importedBy: "bench" }));
  results.push(`| Price Paid full import | ${SALES.toLocaleString("en-GB")} sales | ${(ppdImport.ms / 1000).toFixed(1)} s | ${rate(SALES, ppdImport.ms)} rows/s | ${ppdImport.result.status} |`);
  const updates = Math.round(SALES / 10);
  const updateFile = path.join(directory, "pp-update.csv");
  await writeFile(updateFile, Array.from({ length: updates }, (_, index) => ppdLine(index % 3 === 0 ? SALES + index : index + 1, index % 3 === 0 ? "A" : index % 3 === 1 ? "C" : "D")).join("\n"));
  const updateImport = await timed(() => importPricePaid(importer, { filePath: updateFile, datasetVersion: "2026-09", mode: "update", activate: true, importedBy: "bench" }));
  results.push(`| Price Paid monthly update (copy + apply) | ${updates.toLocaleString("en-GB")} changes on ${SALES.toLocaleString("en-GB")} | ${(updateImport.ms / 1000).toFixed(1)} s | — | ${updateImport.result.status} |`);
  const lookupFile = path.join(directory, "lookup.csv");
  await writeFile(lookupFile, `Transaction unique identifier,UPRN\n${Array.from({ length: SALES }, (_, index) => `${tid(index + 1)},${990000000001 + (index % UPRNS)}`).join("\n")}\n`);
  const lookupImport = await timed(() => importPricePaidUprnLookup(importer, { filePath: lookupFile, datasetVersion: "2026-09", activate: true, importedBy: "bench" }));
  results.push(`| Transaction ↔ UPRN look-up import | ${SALES.toLocaleString("en-GB")} links | ${(lookupImport.ms / 1000).toFixed(1)} s | ${rate(SALES, lookupImport.ms)} rows/s | ${lookupImport.result.status} |`);

  // Query latency on the app role (includes the local WebSocket relay round trip).
  const spatial = databaseSpatialQuery(app);
  const history = databaseHistoryQuery(app);
  const samples = { candidates: [] as number[], layers: [] as number[], sales: [] as number[] };
  for (let index = 0; index < QUERIES; index += 1) {
    const row = uprnRows[(index * 997) % uprnRows.length];
    samples.candidates.push((await timed(() => findUprnCandidates(app, { latitude: row.lat, longitude: row.lon, radiusMetres: 75, limit: 25 }))).ms);
    samples.layers.push((await timed(() => spatial.featuresAt({ sourceKey: "ea_flood_zones", layers: ["flood_zone_3"], latitude: row.lat, longitude: row.lon, nearbyMetres: 50 }))).ms);
    samples.sales.push((await timed(() => history.salesForUprn(row.uprn))).ms);
  }
  for (const [name, values] of Object.entries(samples)) results.push(`| Query: ${name} | ${QUERIES} queries | p50 ${percentile(values, 50).toFixed(1)} ms | p95 ${percentile(values, 95).toFixed(1)} ms | — |`);

  const sizes = await admin.execute(sql`select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as size from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'reference' and relkind = 'r' and relname in ('os_open_uprn', 'spatial_features', 'price_paid_transactions', 'price_paid_uprn_links') order by relname`);
  console.log("| Step | Volume | Time | Throughput | Result |\n|---|---|---|---|---|");
  console.log(results.join("\n"));
  console.log("\nTable sizes (all versions kept):");
  for (const row of (sizes as unknown as { rows: { relname: string; size: string }[] }).rows) console.log(`- reference.${row.relname}: ${row.size}`);
} finally {
  await database.drop();
  await stopRelay();
}
