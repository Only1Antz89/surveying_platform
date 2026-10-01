import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { dataSources, datasetSyncs, type Database, type TenantTransaction } from "@surveynt/db";
import { sourceDefinitions } from "../registry/sources";

type Executor = Database | TenantTransaction;

export async function getActiveSync(db: Executor, sourceKey: string, layer = "") {
  const [row] = await db.select().from(datasetSyncs).where(and(eq(datasetSyncs.sourceKey, sourceKey), eq(datasetSyncs.layer, layer), eq(datasetSyncs.status, "active"))).limit(1);
  return row ?? null;
}

/** A source may run only when an operator has enabled it after verification. Missing rows are disabled. */
export async function getSourceState(db: Executor, sourceKey: string) {
  const [row] = await db.select({ enabled: dataSources.enabled, verifiedAt: dataSources.verifiedAt, registerStatus: dataSources.registerStatus }).from(dataSources).where(eq(dataSources.key, sourceKey)).limit(1);
  return { enabled: Boolean(row?.enabled && row.verifiedAt && row.registerStatus !== "blocked"), registered: Boolean(row) };
}

export async function getSourceStates(db: Executor, keys: string[]) {
  const rows = keys.length ? await db.select({ key: dataSources.key, enabled: dataSources.enabled, verifiedAt: dataSources.verifiedAt, registerStatus: dataSources.registerStatus }).from(dataSources).where(inArray(dataSources.key, keys)) : [];
  return Object.fromEntries(keys.map((key) => {
    const row = rows.find((item) => item.key === key);
    return [key, Boolean(row?.enabled && row.verifiedAt && row.registerStatus !== "blocked")];
  })) as Record<string, boolean>;
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
    select u.uprn, st_y(u.geom) as latitude, st_x(u.geom) as longitude, st_distance(u.geom::geography, origin.g) as distance
    from reference.os_open_uprn u, origin
    where u.dataset_sync_id = ${active.id} and st_dwithin(u.geom::geography, origin.g, ${radius})
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
  const result = await db.execute(sql`select st_y(geom) as latitude, st_x(geom) as longitude from reference.os_open_uprn where dataset_sync_id = ${active.id} and uprn = ${uprn} limit 1`);
  const row = (result as unknown as { rows: { latitude: number | string; longitude: number | string }[] }).rows[0];
  return { referenceAvailable: true, exists: Boolean(row), point: row ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null };
}

async function lockSource(tx: TenantTransaction, sourceKey: string, layer: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dataset_sync:${sourceKey}:${layer}`}))`);
}

/**
 * Atomically makes one completed sync the active version. The previous active
 * version is retired, not deleted, so it remains available for rollback.
 */
export async function activateSync(db: Database, syncId: string) {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(datasetSyncs).where(eq(datasetSyncs.id, syncId)).limit(1);
    if (!target) throw new Error("Dataset sync not found.");
    await lockSource(tx, target.sourceKey, target.layer);
    const [fresh] = await tx.select().from(datasetSyncs).where(eq(datasetSyncs.id, syncId)).limit(1);
    if (fresh.status === "active") return fresh;
    if (fresh.status === "failed" || !fresh.completedAt) throw new Error("Only completed, validated imports can be activated.");
    const [current] = await tx.select().from(datasetSyncs).where(and(eq(datasetSyncs.sourceKey, fresh.sourceKey), eq(datasetSyncs.layer, fresh.layer), eq(datasetSyncs.status, "active"))).limit(1);
    if (current) await tx.update(datasetSyncs).set({ status: "retired", retiredAt: new Date() }).where(eq(datasetSyncs.id, current.id));
    const [activated] = await tx.update(datasetSyncs).set({ status: "active", activatedAt: new Date(), retiredAt: null, previousActiveId: current?.id ?? fresh.previousActiveId }).where(eq(datasetSyncs.id, fresh.id)).returning();
    return activated;
  });
}

/** Re-activates the version that was active before the current one. */
export async function rollbackSource(db: Database, sourceKey: string, layer = "") {
  return db.transaction(async (tx) => {
    await lockSource(tx, sourceKey, layer);
    const current = await getActiveSync(tx, sourceKey, layer);
    if (!current?.previousActiveId) throw new Error("There is no earlier version to roll back to.");
    const [previous] = await tx.select().from(datasetSyncs).where(eq(datasetSyncs.id, current.previousActiveId)).limit(1);
    if (!previous || previous.status !== "retired") throw new Error("The earlier version is no longer available.");
    await tx.update(datasetSyncs).set({ status: "retired", retiredAt: new Date() }).where(and(eq(datasetSyncs.id, current.id), eq(datasetSyncs.status, "active")));
    const [restored] = await tx.update(datasetSyncs).set({ status: "active", activatedAt: new Date(), retiredAt: null }).where(and(eq(datasetSyncs.id, previous.id), eq(datasetSyncs.status, "retired"))).returning();
    if (!restored) throw new Error("Rollback could not be applied.");
    return restored;
  });
}

/** Keeps the newest `keep` retired versions for rollback and deletes older ones (rows cascade). */
export async function pruneRetiredSyncs(db: Database, sourceKey: string, keep = 2, layer = "") {
  const retired = await db.select({ id: datasetSyncs.id }).from(datasetSyncs).where(and(eq(datasetSyncs.sourceKey, sourceKey), eq(datasetSyncs.layer, layer), inArray(datasetSyncs.status, ["retired", "failed"]))).orderBy(desc(datasetSyncs.startedAt));
  const removable = retired.slice(keep).map((row) => row.id);
  if (removable.length) await db.delete(datasetSyncs).where(inArray(datasetSyncs.id, removable));
  return removable.length;
}

/**
 * Upserts registry metadata into reference.data_sources. Operator decisions
 * (enabled, verification) are preserved, except that a source the register marks
 * as blocked is always disabled.
 */
export async function syncSourceRegistry(db: Database) {
  for (const source of sourceDefinitions) {
    const values = {
      name: source.name,
      organisation: source.organisation,
      category: source.category,
      documentationUrl: source.documentationUrl,
      accessMethod: source.accessMethod,
      coverage: [...source.coverage],
      licence: source.licence as unknown as Record<string, unknown>,
      registerStatus: source.registerStatus,
      checkedAt: source.checkedAt,
      definition: source as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    };
    await db.insert(dataSources).values({ key: source.key, ...values }).onConflictDoUpdate({
      target: dataSources.key,
      set: { ...values, ...(source.registerStatus === "blocked" ? { enabled: false } : {}) },
    });
  }
  return sourceDefinitions.length;
}
