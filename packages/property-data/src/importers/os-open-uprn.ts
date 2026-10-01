import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { eq, sql } from "drizzle-orm";
import { datasetSyncs, type Database } from "@surveynt/db";
import { getSourceDefinition } from "../registry/sources";
import { isValidUprn } from "../matching/identity";
import { activateSync } from "../db/reference";

// GB extent of OS Open UPRN in WGS84/ETRS89 (Northern Ireland is not covered).
const gbBounds = { minLatitude: 49.85, maxLatitude: 60.95, minLongitude: -8.7, maxLongitude: 1.8 };
const expectedHeader = ["UPRN", "X_COORDINATE", "Y_COORDINATE", "LATITUDE", "LONGITUDE"];

export type Bbox = { minLongitude: number; minLatitude: number; maxLongitude: number; maxLatitude: number };

export type OsOpenUprnImportOptions = {
  filePath: string;
  datasetVersion: string;
  sourceUrl?: string;
  /** Optional regional extract for benchmarking before any national load. */
  bbox?: Bbox;
  batchSize?: number;
  activate?: boolean;
  importedBy: string;
  /** Maximum tolerated distance between OS-supplied ETRS89 coordinates and the transformed BNG point. */
  maxCrsDiscrepancyMetres?: number;
};

export type ImportOutcome = { syncId: string; status: "staging" | "active" | "failed"; recordCount: number; skipped: number; validation: Record<string, unknown>; error?: string };

export async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function parseRow(line: string) {
  const parts = line.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  if (parts.length !== 5) return null;
  const [uprn, x, y, latitude, longitude] = [parts[0], Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4])];
  if (!isValidUprn(uprn) || [x, y, latitude, longitude].some((value) => !Number.isFinite(value))) return null;
  if (latitude < gbBounds.minLatitude || latitude > gbBounds.maxLatitude || longitude < gbBounds.minLongitude || longitude > gbBounds.maxLongitude) return null;
  return { uprn, x, y, latitude, longitude };
}

function inside(bbox: Bbox | undefined, row: { latitude: number; longitude: number }) {
  return !bbox || (row.longitude >= bbox.minLongitude && row.longitude <= bbox.maxLongitude && row.latitude >= bbox.minLatitude && row.latitude <= bbox.maxLatitude);
}

/**
 * Staged, versioned import. Rows load under a new dataset_syncs id that no
 * query reads until activation. Validation failures mark the sync failed and
 * remove its rows; the active version is never touched.
 *
 * Coordinates: OS supplies ETRS89 latitude/longitude, used directly as EPSG:4326
 * (sub-metre in GB). BNG (EPSG:27700) values are retained and cross-checked.
 */
export async function importOsOpenUprn(db: Database, options: OsOpenUprnImportOptions): Promise<ImportOutcome> {
  const definition = getSourceDefinition("os_open_uprn");
  if (!definition) throw new Error("os_open_uprn is not registered.");
  const checksum = await sha256File(options.filePath);
  const [sync] = await db.insert(datasetSyncs).values({
    sourceKey: "os_open_uprn",
    datasetVersion: options.datasetVersion,
    sourceUrl: options.sourceUrl ?? definition.accessUrls[0] ?? null,
    checksum,
    licence: definition.licence as unknown as Record<string, unknown>,
    sourceCrs: "EPSG:27700 (BNG) with ETRS89 latitude/longitude",
    extent: options.bbox ? `bbox ${options.bbox.minLongitude},${options.bbox.minLatitude},${options.bbox.maxLongitude},${options.bbox.maxLatitude}` : "full file",
    importedBy: options.importedBy,
  }).returning();
  let recordCount = 0;
  let skipped = 0;
  try {
    const lines = createInterface({ input: createReadStream(options.filePath), crlfDelay: Infinity });
    let header: string[] | null = null;
    let batch: { uprn: string; x: number; y: number; latitude: number; longitude: number }[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await db.execute(sql`
        insert into reference.os_open_uprn (dataset_sync_id, uprn, geom, source_x, source_y)
        select ${sync.id}::uuid, t.uprn, st_setsrid(st_makepoint(t.lon, t.lat), 4326), t.x, t.y
        from unnest(${sql.param(batch.map((row) => row.uprn))}::text[], ${sql.param(batch.map((row) => row.longitude))}::float8[], ${sql.param(batch.map((row) => row.latitude))}::float8[], ${sql.param(batch.map((row) => row.x))}::float8[], ${sql.param(batch.map((row) => row.y))}::float8[]) as t(uprn, lon, lat, x, y)
        on conflict do nothing`);
      recordCount += batch.length;
      batch = [];
    };
    for await (const raw of lines) {
      const line = raw.replace(/^﻿/, "").trim();
      if (!line) continue;
      if (!header) {
        header = line.split(",").map((part) => part.trim().replace(/^"|"$/g, "").toUpperCase());
        if (header.join(",") !== expectedHeader.join(",")) throw new Error(`Unexpected header. Expected ${expectedHeader.join(",")}.`);
        continue;
      }
      const row = parseRow(line);
      if (!row) { skipped += 1; continue; }
      if (!inside(options.bbox, row)) continue;
      batch.push(row);
      if (batch.length >= (options.batchSize ?? 5000)) await flush();
    }
    await flush();
    if (!header) throw new Error("The file is empty.");
    const counted = await db.execute(sql`select count(*)::int as count from reference.os_open_uprn where dataset_sync_id = ${sync.id}`);
    const stored = Number((counted as unknown as { rows: { count: number }[] }).rows[0]?.count ?? 0);
    if (stored === 0) throw new Error("No valid UPRN rows were found for the requested extent.");
    const tolerance = options.maxCrsDiscrepancyMetres ?? 25;
    const crsCheck = await db.execute(sql`
      select count(*)::int as sampled,
        count(*) filter (where st_distance(st_transform(st_setsrid(st_makepoint(source_x, source_y), 27700), 4326)::geography, geom::geography) > ${tolerance})::int as discrepant
      from (select geom, source_x, source_y from reference.os_open_uprn where dataset_sync_id = ${sync.id} limit 2000) sample`);
    const crs = (crsCheck as unknown as { rows: { sampled: number; discrepant: number }[] }).rows[0];
    const validation = { storedRows: stored, skippedRows: skipped, crsSampled: crs.sampled, crsDiscrepant: crs.discrepant, crsToleranceMetres: tolerance };
    if (crs.discrepant > 0) throw Object.assign(new Error(`${crs.discrepant} sampled rows disagree between BNG and latitude/longitude by more than ${tolerance} m.`), { validation });
    await db.update(datasetSyncs).set({ recordCount: stored, validation, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
    if (options.activate) {
      await activateSync(db, sync.id);
      return { syncId: sync.id, status: "active", recordCount: stored, skipped, validation };
    }
    return { syncId: sync.id, status: "staging", recordCount: stored, skipped, validation };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message.slice(0, 1000) : "Import failed.";
    const validation = (reason as { validation?: Record<string, unknown> }).validation ?? { skippedRows: skipped };
    await db.execute(sql`delete from reference.os_open_uprn where dataset_sync_id = ${sync.id}`);
    await db.update(datasetSyncs).set({ status: "failed", error: message, validation, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
    return { syncId: sync.id, status: "failed", recordCount: 0, skipped, validation, error: message };
  }
}
