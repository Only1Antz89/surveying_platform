import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { auditEvents, createDatabase, dataSources, datasetSyncs, datasetVersions } from "../src/index";

type Arguments = { source: string; version: string; file: string; sourceUrl: string; activate: boolean; dryRun: boolean };
const spatialSources = new Set(["historic_england", "hmlr_inspire", "ea_flood_zone_2", "ea_flood_zone_3"]);

function parseArguments(values: string[]): Arguments {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) options.set(values[index], values[index + 1]);
  const source = options.get("--source") ?? "";
  const version = options.get("--version") ?? "";
  const file = options.get("--file") ?? "";
  const sourceUrl = options.get("--source-url") ?? "";
  if (!source || !version || !file || !sourceUrl) throw new Error("Usage: --source <key> --version <version> --file <csv> --source-url <url> [--activate true] [--dry-run true]");
  if (source !== "os_open_uprn" && !spatialSources.has(source)) throw new Error(`Unsupported source: ${source}`);
  return { source, version, file, sourceUrl, activate: options.get("--activate") === "true", dryRun: options.get("--dry-run") === "true" };
}

async function checksum(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function splitCsv(line: string) {
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

async function inspect(path: string, source: string) {
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
  return { bytes: file.size, recordCount: count, invalidRows: invalid, headers, missingColumns: missing, estimatedTableBytes: Math.round(file.size * (source === "os_open_uprn" ? 1.8 : 2.5)), requiresPostgis: true };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = await inspect(options.file, options.source);
  const fileChecksum = await checksum(options.file);
  console.log(JSON.stringify({ source: options.source, version: options.version, checksum: fileChecksum, capacity: report }, null, 2));
  if (report.invalidRows || report.missingColumns.length) throw new Error("Capacity validation failed; no data was imported.");
  if (options.dryRun) return;
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required. Imports must never use the tenant application role.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  await db.execute(sql`select PostGIS_Full_Version()`);
  const [source] = await db.select({ key: dataSources.key }).from(dataSources).where(eq(dataSources.key, options.source)).limit(1);
  if (!source) throw new Error("The source registry migration must be applied before importing.");
  const [sync] = await db.insert(datasetSyncs).values({ sourceKey: options.source, sourceUrl: options.sourceUrl, checksum: fileChecksum, status: "validating", startedAt: new Date(), validation: { capacity: report } }).returning();
  const [version] = await db.insert(datasetVersions).values({ sourceKey: options.source, version: options.version, checksum: fileChecksum, sourceUrl: options.sourceUrl, recordCount: 0, validation: { capacity: report }, licenceSnapshot: {} }).onConflictDoNothing().returning();
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
        batch.push(sql`(${version.id}, ${options.source}, ${row.source_record_id}, ${row.name || null}, ST_Force2D(ST_SetSRID(ST_GeomFromText(${row.wkt}), 4326)), ${JSON.stringify(properties)}::jsonb)`);
      }
      imported += 1;
      if (batch.length >= 500) await flush();
    }
    await flush();
    if (imported !== report.recordCount) throw new Error(`Expected ${report.recordCount} records but imported ${imported}.`);
    await db.transaction(async (tx) => {
      await tx.update(datasetVersions).set({ recordCount: imported, validation: { capacity: report, imported, checksumVerified: true }, updatedAt: new Date() }).where(eq(datasetVersions.id, version.id));
      if (options.activate) {
        await tx.update(datasetVersions).set({ active: false, updatedAt: new Date() }).where(and(eq(datasetVersions.sourceKey, options.source), eq(datasetVersions.active, true)));
        await tx.update(datasetVersions).set({ active: true, activatedAt: new Date(), updatedAt: new Date() }).where(eq(datasetVersions.id, version.id));
        await tx.update(dataSources).set({ enabled: true, latestSuccessfulSyncAt: new Date(), updatedAt: new Date() }).where(eq(dataSources.key, options.source));
      }
      await tx.update(datasetSyncs).set({ datasetVersionId: version.id, status: options.activate ? "active" : "staged", recordCount: imported, validation: { capacity: report, checksumVerified: true }, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
      await tx.insert(auditEvents).values({ action: options.activate ? "property_data.version_activated" : "property_data.import_staged", resourceType: "dataset_version", resourceId: version.id, metadata: { source: options.source, version: options.version, syncId: sync.id, records: imported, checksum: fileChecksum } });
    });
  } catch (error) {
    const safeError = error instanceof Error ? error.message.slice(0, 500) : "Import failed";
    await db.update(datasetSyncs).set({ status: "failed", safeError, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
    await db.insert(auditEvents).values({ action: "property_data.import_failed", resourceType: "dataset_version", resourceId: version.id, metadata: { source: options.source, version: options.version, syncId: sync.id, safeError } });
    await db.delete(datasetVersions).where(eq(datasetVersions.id, version.id));
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
