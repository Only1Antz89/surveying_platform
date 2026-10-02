import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { dataSources, datasetSyncs, datasetVersions, type Database, type TenantTransaction } from "@surveynt/db";
import { sourceDefinitions } from "../registry/sources";

// Reference data lives in the England release's tables (migration 0006):
// data_sources, dataset_versions (one row per imported version, one active per
// source and layer), dataset_syncs (job log) and the row tables. This module
// is the single place that maps them onto this package's vocabulary.

type Executor = Database | TenantTransaction;
type VersionRow = typeof datasetVersions.$inferSelect;

export type VersionStatus = "staging" | "active" | "retired";

/** A dataset version as this package uses it. `status` is derived from main's active flag and dates. */
export type ReferenceVersion = {
  id: string;
  sourceKey: string;
  layer: string;
  datasetVersion: string;
  status: VersionStatus;
  recordCount: number;
  validation: Record<string, unknown>;
  checksum: string;
  sourceUrl: string;
  extent: string | null;
  importedBy: string | null;
  previousActiveId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  activatedAt: Date | null;
  retiredAt: Date | null;
};

export function versionStatus(row: Pick<VersionRow, "active" | "activatedAt" | "retiredAt">): VersionStatus {
  if (row.active) return "active";
  return row.retiredAt || row.activatedAt ? "retired" : "staging";
}

export function toReferenceVersion(row: VersionRow): ReferenceVersion {
  return {
    id: row.id, sourceKey: row.sourceKey, layer: row.layer, datasetVersion: row.version, status: versionStatus(row), recordCount: row.recordCount, validation: row.validation,
    checksum: row.checksum, sourceUrl: row.sourceUrl, extent: row.extent, importedBy: row.importedBy, previousActiveId: row.previousActiveId,
    startedAt: row.createdAt, completedAt: row.completedAt, activatedAt: row.activatedAt, retiredAt: row.retiredAt,
  };
}

export async function getActiveSync(db: Executor, sourceKey: string, layer = ""): Promise<ReferenceVersion | null> {
  const [row] = await db.select().from(datasetVersions).where(and(eq(datasetVersions.sourceKey, sourceKey), eq(datasetVersions.layer, layer), eq(datasetVersions.active, true))).limit(1);
  return row ? toReferenceVersion(row) : null;
}

export async function getVersion(db: Executor, id: string) {
  const [row] = await db.select().from(datasetVersions).where(eq(datasetVersions.id, id)).limit(1);
  return row ? toReferenceVersion(row) : null;
}

const runnable = (row: { enabled: boolean; verifiedAt: Date | null; registerStatus: string | null } | undefined) => Boolean(row?.enabled && row.verifiedAt && row.registerStatus !== "blocked");

/** A source may run only when an operator has enabled it after verification. Missing rows are disabled. */
export async function getSourceState(db: Executor, sourceKey: string) {
  const [row] = await db.select({ enabled: dataSources.enabled, verifiedAt: dataSources.verifiedAt, registerStatus: dataSources.registerStatus }).from(dataSources).where(eq(dataSources.key, sourceKey)).limit(1);
  return { enabled: runnable(row), registered: Boolean(row) };
}

export async function getSourceStates(db: Executor, keys: string[]) {
  const rows = keys.length ? await db.select({ key: dataSources.key, enabled: dataSources.enabled, verifiedAt: dataSources.verifiedAt, registerStatus: dataSources.registerStatus }).from(dataSources).where(inArray(dataSources.key, keys)) : [];
  return Object.fromEntries(keys.map((key) => [key, runnable(rows.find((item) => item.key === key))])) as Record<string, boolean>;
}

export type UprnCandidateRow = { uprn: string; latitude: number; longitude: number; distanceMetres: number };

/** Nearest OS Open UPRN points from the active dataset version, using metre distances on the geography type. */
export async function findUprnCandidates(db: Executor, input: { latitude: number; longitude: number; radiusMetres: number; limit?: number }) {
  const active = await getActiveSync(db, "os_open_uprn");
  if (!active) return { referenceAvailable: false, datasetVersion: null, candidates: [] as UprnCandidateRow[] };
  const limit = Math.max(1, Math.min(input.limit ?? 25, 50));
  const radius = Math.max(1, Math.min(input.radiusMetres, 500));
  const result = await db.execute(sql`
    with origin as (select st_setsrid(st_makepoint(${input.longitude}, ${input.latitude}), 4326)::geography as g)
    select u.uprn, st_y(u.location) as latitude, st_x(u.location) as longitude, st_distance(u.location::geography, origin.g) as distance
    from os_uprn_points u, origin
    where u.dataset_version_id = ${active.id} and st_dwithin(u.location::geography, origin.g, ${radius})
    order by distance, u.uprn
    limit ${limit}`);
  const rows = (result as unknown as { rows: { uprn: string; latitude: number | string; longitude: number | string; distance: number | string }[] }).rows;
  return {
    referenceAvailable: true,
    datasetVersion: active.datasetVersion,
    candidates: rows.map((row) => ({ uprn: row.uprn, latitude: Number(row.latitude), longitude: Number(row.longitude), distanceMetres: Number(row.distance) })),
  };
}

/** Whether a UPRN exists in the active OS Open UPRN version. Existence is not identity: confirmation is still required. */
export async function uprnExists(db: Executor, uprn: string) {
  const active = await getActiveSync(db, "os_open_uprn");
  if (!active) return { referenceAvailable: false, exists: false, point: null as { latitude: number; longitude: number } | null };
  const result = await db.execute(sql`select st_y(location) as latitude, st_x(location) as longitude from os_uprn_points where dataset_version_id = ${active.id} and uprn = ${uprn} limit 1`);
  const row = (result as unknown as { rows: { latitude: number | string; longitude: number | string }[] }).rows[0];
  return { referenceAvailable: true, exists: Boolean(row), point: row ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null };
}

async function lockSource(tx: TenantTransaction, sourceKey: string, layer: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dataset_version:${sourceKey}:${layer}`}))`);
}

/** Records an entry in the shared job log (dataset_syncs). */
export async function logSync(db: Executor, version: Pick<ReferenceVersion, "id" | "sourceKey" | "sourceUrl" | "checksum" | "recordCount" | "validation">, status: "validating" | "staged" | "active" | "failed" | "rolled_back", safeError: string | null = null) {
  const now = new Date();
  await db.insert(datasetSyncs).values({ sourceKey: version.sourceKey, datasetVersionId: status === "failed" ? null : version.id, status, sourceUrl: version.sourceUrl, checksum: version.checksum, recordCount: version.recordCount, validation: version.validation, safeError, startedAt: now, completedAt: status === "validating" ? null : now });
}

/**
 * Atomically makes one completed version the active one for its source and
 * layer. The previous active version is retired, not deleted, for rollback.
 */
export async function activateSync(db: Database, versionId: string) {
  return db.transaction(async (tx) => {
    const target = await getVersion(tx, versionId);
    if (!target) throw new Error("Dataset version not found.");
    await lockSource(tx, target.sourceKey, target.layer);
    const fresh = (await getVersion(tx, versionId))!;
    if (fresh.status === "active") return fresh;
    if (!fresh.completedAt && fresh.recordCount === 0) throw new Error("Only completed, validated imports can be activated.");
    const current = await getActiveSync(tx, fresh.sourceKey, fresh.layer);
    const now = new Date();
    if (current) await tx.update(datasetVersions).set({ active: false, retiredAt: now, updatedAt: now }).where(eq(datasetVersions.id, current.id));
    const [activated] = await tx.update(datasetVersions).set({ active: true, activatedAt: now, retiredAt: null, previousActiveId: current?.id ?? fresh.previousActiveId, updatedAt: now }).where(eq(datasetVersions.id, fresh.id)).returning();
    const version = toReferenceVersion(activated);
    await logSync(tx, version, "active");
    return version;
  });
}

/** Re-activates the version that was active before the current one. */
export async function rollbackSource(db: Database, sourceKey: string, layer = "") {
  return db.transaction(async (tx) => {
    await lockSource(tx, sourceKey, layer);
    const current = await getActiveSync(tx, sourceKey, layer);
    if (!current?.previousActiveId) throw new Error("There is no earlier version to roll back to.");
    const previous = await getVersion(tx, current.previousActiveId);
    if (!previous || previous.status !== "retired") throw new Error("The earlier version is no longer available.");
    const now = new Date();
    await tx.update(datasetVersions).set({ active: false, retiredAt: now, updatedAt: now }).where(and(eq(datasetVersions.id, current.id), eq(datasetVersions.active, true)));
    const [restored] = await tx.update(datasetVersions).set({ active: true, activatedAt: now, retiredAt: null, updatedAt: now }).where(and(eq(datasetVersions.id, previous.id), eq(datasetVersions.active, false))).returning();
    if (!restored) throw new Error("Rollback could not be applied.");
    const version = toReferenceVersion(restored);
    await logSync(tx, version, "rolled_back");
    return version;
  });
}

/** Keeps the newest `keep` retired versions for rollback and deletes older ones (rows cascade). */
export async function pruneRetiredSyncs(db: Database, sourceKey: string, keep = 2, layer = "") {
  const retired = await db.select({ id: datasetVersions.id }).from(datasetVersions)
    .where(and(eq(datasetVersions.sourceKey, sourceKey), eq(datasetVersions.layer, layer), eq(datasetVersions.active, false), isNotNull(datasetVersions.retiredAt)))
    .orderBy(desc(datasetVersions.createdAt));
  const removable = retired.slice(keep).map((row) => row.id);
  if (removable.length) await db.delete(datasetVersions).where(inArray(datasetVersions.id, removable));
  return removable.length;
}

/**
 * Upserts register metadata into data_sources. Operator decisions (enabled,
 * verification) are preserved, except that a source the register marks as
 * blocked is always disabled. Rows created by the England import scripts keep
 * their descriptive fields; only register columns are filled in.
 */
export async function syncSourceRegistry(db: Database) {
  for (const source of sourceDefinitions) {
    const register = {
      accessMethod: source.accessMethod,
      registerStatus: source.registerStatus,
      checkedAt: source.checkedAt,
      definition: source as unknown as Record<string, unknown>,
      licenceSnapshot: source.licence as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    };
    await db.insert(dataSources).values({
      key: source.key, name: source.name, organisation: source.organisation, category: source.category, documentationUrl: source.documentationUrl,
      accessUrl: source.accessUrls[0]?.startsWith("http") ? source.accessUrls[0] : null, licence: source.licence.name, licenceUrl: source.licence.url ?? null,
      attribution: source.licence.attribution, coverageCountries: [...source.coverage], limitations: source.guardrail, accessRequirements: source.accessRequirements,
      enabled: false, ...register,
    }).onConflictDoUpdate({
      target: dataSources.key,
      set: { ...register, ...(source.registerStatus === "blocked" ? { enabled: false } : {}) },
    });
  }
  return sourceDefinitions.length;
}
