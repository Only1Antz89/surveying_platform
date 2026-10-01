import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { eq, sql, type SQL } from "drizzle-orm";
import { auditEvents, createDatabase, dataSources, datasetSyncs, datasetVersions } from "../src/index";

type SourceCrs = "EPSG:4326" | "EPSG:27700";
export type ImportArguments = { source: string; version: string; file: string; sourceUrl: string; sourceCrs: SourceCrs; expectedChecksum?: string; licenceConfirmed: boolean; neonStorageUsdPerGbMonth?: number; dryRun: boolean };
const spatialSources = new Set(["historic_england", "hmlr_inspire", "ea_flood_zone_2", "ea_flood_zone_3"]);

export function parseArguments(values: string[]): ImportArguments {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) options.set(values[index], values[index + 1]);
  const source = options.get("--source") ?? "";
  const version = options.get("--version") ?? "";
  const file = options.get("--file") ?? "";
  const sourceUrl = options.get("--source-url") ?? "";
  const sourceCrs = options.get("--source-crs");
  if (!source || !version || !file || !sourceUrl || (sourceCrs !== "EPSG:4326" && sourceCrs !== "EPSG:27700")) throw new Error("Usage: --source <key> --version <version> --file <csv> --source-url <https-url> --source-crs <EPSG:4326|EPSG:27700> [--expected-checksum <sha256>] [--licence-confirmed true] [--neon-storage-usd-per-gb-month <amount>] [--dry-run true]");
  if (source !== "os_open_uprn" && !spatialSources.has(source)) throw new Error(`Unsupported source: ${source}`);
  if (source === "os_open_uprn" && sourceCrs !== "EPSG:4326") throw new Error("OS Open UPRN CSV latitude/longitude imports must declare EPSG:4326.");
  const parsedUrl = new URL(sourceUrl);
  if (parsedUrl.protocol !== "https:") throw new Error("Source URL must use HTTPS.");
  const expectedChecksum = options.get("--expected-checksum")?.toLowerCase();
  if (expectedChecksum && !/^[a-f0-9]{64}$/.test(expectedChecksum)) throw new Error("Expected checksum must be a 64-character SHA-256 value.");
  const neonStorageUsdPerGbMonth = options.has("--neon-storage-usd-per-gb-month") ? Number(options.get("--neon-storage-usd-per-gb-month")) : undefined;
  if (neonStorageUsdPerGbMonth !== undefined && (!Number.isFinite(neonStorageUsdPerGbMonth) || neonStorageUsdPerGbMonth < 0)) throw new Error("Neon storage cost must be a non-negative number.");
  if (options.has("--activate")) throw new Error("Import and activation are separate gates. Use activate:property-data after reviewing the staged capacity report.");
  return { source, version, file, sourceUrl, sourceCrs, expectedChecksum, licenceConfirmed: options.get("--licence-confirmed") === "true", neonStorageUsdPerGbMonth, dryRun: options.get("--dry-run") === "true" };
}

async function checksum(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function splitCsv(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(current); current = ""; }
    else current += char;
  }
  values.push(current);
  return values;
}

export async function inspectImport(path: string, source: string, sourceCrs: SourceCrs, neonStorageUsdPerGbMonth?: number) {
  const file = await stat(path);
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let count = -1;
  let invalid = 0;
  let headers: string[] = [];
  for await (const line of lines) {
    if (count === -1) { headers = splitCsv(line).map((value) => value.trim().toLowerCase()); count = 0; continue; }
    if (!line.trim()) continue;
    count += 1;
    const values = splitCsv(line);
    if (values.length !== headers.length) invalid += 1;
  }
  const required = source === "os_open_uprn" ? ["uprn", "latitude", "longitude"] : ["source_record_id", "wkt"];
  const missing = required.filter((column) => !headers.includes(column));
  const estimatedTableBytes = Math.round(file.size * (source === "os_open_uprn" ? 1.8 : 2.5));
  return { bytes: file.size, recordCount: count, invalidRows: invalid, headers, missingColumns: missing, sourceCrs, estimatedTableBytes, projectedStorageUsdPerMonth: neonStorageUsdPerGbMonth === undefined ? null : Number(((estimatedTableBytes / 1024 ** 3) * neonStorageUsdPerGbMonth).toFixed(4)), requiresPostgis: true };
}

async function databaseCapacityReport(db: ReturnType<typeof createDatabase>, source: string, versionId: string, recordCount: number, neonStorageUsdPerGbMonth?: number) {
  const relation = source === "os_open_uprn" ? "os_uprn_points" : "spatial_reference_features";
  const [sizes, sample] = await Promise.all([
    db.execute(sql`select pg_total_relation_size(${relation}::regclass) as total_bytes, pg_indexes_size(${relation}::regclass) as index_bytes`),
    source === "os_open_uprn"
      ? db.execute(sql`select ST_X(location) as longitude, ST_Y(location) as latitude from os_uprn_points where dataset_version_id = ${versionId} limit 1`)
      : db.execute(sql`select ST_X(ST_PointOnSurface(geometry)) as longitude, ST_Y(ST_PointOnSurface(geometry)) as latitude from spatial_reference_features where dataset_version_id = ${versionId} limit 1`),
  ]);
  const point = sample.rows[0] as { longitude?: string | number; latitude?: string | number } | undefined;
  const started = performance.now();
  if (point?.longitude !== undefined && point.latitude !== undefined) {
    if (source === "os_open_uprn") await db.execute(sql`select uprn from os_uprn_points where dataset_version_id = ${versionId} and ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(${Number(point.longitude)}, ${Number(point.latitude)}), 4326)::geography, 75) limit 20`);
    else await db.execute(sql`select source_record_id from spatial_reference_features where dataset_version_id = ${versionId} and ST_Intersects(geometry, ST_SetSRID(ST_MakePoint(${Number(point.longitude)}, ${Number(point.latitude)}), 4326)) limit 100`);
  }
  const queryLatencyMs = Number((performance.now() - started).toFixed(2));
  const row = sizes.rows[0] as { total_bytes?: string | number; index_bytes?: string | number } | undefined;
  const totalBytes = Number(row?.total_bytes ?? 0);
  const indexBytes = Number(row?.index_bytes ?? 0);
  return { recordCount, relation, totalBytes, indexBytes, queryLatencyMs, projectedStorageUsdPerMonth: neonStorageUsdPerGbMonth === undefined ? null : Number(((totalBytes / 1024 ** 3) * neonStorageUsdPerGbMonth).toFixed(4)) };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = await inspectImport(options.file, options.source, options.sourceCrs, options.neonStorageUsdPerGbMonth);
  const fileChecksum = await checksum(options.file);
  console.log(JSON.stringify({ source: options.source, version: options.version, checksum: fileChecksum, capacity: report }, null, 2));
  if (report.invalidRows || report.missingColumns.length) throw new Error("Capacity validation failed; no data was imported.");
  if (options.expectedChecksum && options.expectedChecksum !== fileChecksum) throw new Error("Checksum verification failed; no data was imported.");
  if (options.dryRun) return;
  if (!options.licenceConfirmed) throw new Error("Import requires --licence-confirmed true after reviewing the source-specific terms.");
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required. Imports must never use the tenant application role.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  await db.execute(sql`select PostGIS_Full_Version()`);
  const [source] = await db.select({ key: dataSources.key, licence: dataSources.licence, licenceUrl: dataSources.licenceUrl, attribution: dataSources.attribution }).from(dataSources).where(eq(dataSources.key, options.source)).limit(1);
  if (!source) throw new Error("The source registry migration must be applied before importing.");
  const [sync] = await db.insert(datasetSyncs).values({ sourceKey: options.source, sourceUrl: options.sourceUrl, checksum: fileChecksum, status: "validating", startedAt: new Date(), validation: { capacity: report } }).returning();
  const [version] = await db.insert(datasetVersions).values({ sourceKey: options.source, version: options.version, checksum: fileChecksum, sourceUrl: options.sourceUrl, recordCount: 0, validation: { capacity: report }, licenceSnapshot: { licence: source.licence, licenceUrl: source.licenceUrl, attribution: source.attribution, confirmedAt: new Date().toISOString() } }).onConflictDoNothing().returning();
  if (!version) throw new Error("This source version already exists; imports are idempotent and will not replace it.");
  await db.insert(auditEvents).values({ action: "property_data.import_started", resourceType: "dataset_version", resourceId: version.id, metadata: { source: options.source, version: options.version, syncId: sync.id, checksum: fileChecksum } });
  try {
    const lines = createInterface({ input: createReadStream(options.file), crlfDelay: Infinity });
    let headers: string[] = [];
    let imported = 0;
    let batch: SQL[] = [];
    async function flush() {
      if (!batch.length) return;
      if (options.source === "os_open_uprn") await db.execute(sql`insert into os_uprn_points (dataset_version_id, uprn, location, source_easting, source_northing) values ${sql.join(batch, sql`, `)}`);
      else await db.execute(sql`insert into spatial_reference_features (dataset_version_id, source_key, source_record_id, name, geometry, properties) values ${sql.join(batch, sql`, `)}`);
      batch = [];
    }
    for await (const line of lines) {
      if (!headers.length) { headers = splitCsv(line).map((value) => value.trim().toLowerCase()); continue; }
      if (!line.trim()) continue;
      const values = splitCsv(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      if (options.source === "os_open_uprn") {
        if (!/^\d{1,12}$/.test(row.uprn) || !Number.isFinite(Number(row.latitude)) || !Number.isFinite(Number(row.longitude))) throw new Error(`Invalid OS Open UPRN record at row ${imported + 2}`);
        batch.push(sql`(${version.id}, ${row.uprn}, ST_SetSRID(ST_MakePoint(${Number(row.longitude)}, ${Number(row.latitude)}), 4326), ${row.x_coordinate ? Number(row.x_coordinate) : null}, ${row.y_coordinate ? Number(row.y_coordinate) : null})`);
      } else {
        let properties: Record<string, unknown> = {};
        if (row.properties_json) properties = JSON.parse(row.properties_json) as Record<string, unknown>;
        const sourceSrid = options.sourceCrs === "EPSG:27700" ? 27700 : 4326;
        batch.push(sql`(${version.id}, ${options.source}, ${row.source_record_id}, ${row.name || null}, ST_Force2D(ST_Transform(ST_SetSRID(ST_GeomFromText(${row.wkt}), ${sourceSrid}), 4326)), ${JSON.stringify(properties)}::jsonb)`);
      }
      imported += 1;
      if (batch.length >= 500) await flush();
    }
    await flush();
    if (imported !== report.recordCount) throw new Error(`Expected ${report.recordCount} records but imported ${imported}.`);
    const measuredCapacity = await databaseCapacityReport(db, options.source, version.id, imported, options.neonStorageUsdPerGbMonth);
    console.log(JSON.stringify({ source: options.source, version: options.version, measuredCapacity }, null, 2));
    await db.transaction(async (tx) => {
      await tx.update(datasetVersions).set({ recordCount: imported, validation: { capacity: report, measuredCapacity, imported, checksumVerified: Boolean(options.expectedChecksum) }, updatedAt: new Date() }).where(eq(datasetVersions.id, version.id));
      await tx.update(datasetSyncs).set({ datasetVersionId: version.id, status: "staged", recordCount: imported, validation: { capacity: report, measuredCapacity, checksumVerified: Boolean(options.expectedChecksum), capacityApproved: false }, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
      await tx.insert(auditEvents).values({ action: "property_data.import_staged", resourceType: "dataset_version", resourceId: version.id, metadata: { source: options.source, version: options.version, syncId: sync.id, records: imported, checksum: fileChecksum } });
    });
  } catch (error) {
    const safeError = error instanceof Error ? error.message.slice(0, 500) : "Import failed";
    await db.update(datasetSyncs).set({ status: "failed", safeError, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
    await db.insert(auditEvents).values({ action: "property_data.import_failed", resourceType: "dataset_version", resourceId: version.id, metadata: { source: options.source, version: options.version, syncId: sync.id, safeError } });
    await db.delete(datasetVersions).where(eq(datasetVersions.id, version.id));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
