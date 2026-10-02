import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { dataSources, referenceDataSources, referenceDatasetSyncs, type Database, type TenantTransaction } from "@surveynt/db";
import { sourceDefinitions } from "../registry/sources";

type Executor = Database | TenantTransaction;

export async function getActiveSync(db: Executor, sourceKey: string, layer = "") {
  const [row] = await db.select().from(referenceDatasetSyncs).where(and(eq(referenceDatasetSyncs.sourceKey, sourceKey), eq(referenceDatasetSyncs.layer, layer), eq(referenceDatasetSyncs.status, "active"))).limit(1);
  return row ?? null;
}

/** A source may run only when an operator has enabled it after verification. Missing rows are disabled. */
export async function getSourceState(db: Executor, sourceKey: string) {
  const [row] = await db.select({ enabled: referenceDataSources.enabled, verifiedAt: referenceDataSources.verifiedAt, registerStatus: referenceDataSources.registerStatus }).from(referenceDataSources).where(eq(referenceDataSources.key, sourceKey)).limit(1);
  return { enabled: Boolean(row?.enabled && row.verifiedAt && row.registerStatus !== "blocked"), registered: Boolean(row) };
}

export async function getSourceStates(db: Executor, keys: string[]) {
  const rows = keys.length ? await db.select({ key: referenceDataSources.key, enabled: referenceDataSources.enabled, verifiedAt: referenceDataSources.verifiedAt, registerStatus: referenceDataSources.registerStatus }).from(referenceDataSources).where(inArray(referenceDataSources.key, keys)) : [];
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
    const [target] = await tx.select().from(referenceDatasetSyncs).where(eq(referenceDatasetSyncs.id, syncId)).limit(1);
    if (!target) throw new Error("Dataset sync not found.");
    await lockSource(tx, target.sourceKey, target.layer);
    const [fresh] = await tx.select().from(referenceDatasetSyncs).where(eq(referenceDatasetSyncs.id, syncId)).limit(1);
    if (fresh.status === "active") return fresh;
    if (fresh.status === "failed" || !fresh.completedAt) throw new Error("Only completed, validated imports can be activated.");
    const [current] = await tx.select().from(referenceDatasetSyncs).where(and(eq(referenceDatasetSyncs.sourceKey, fresh.sourceKey), eq(referenceDatasetSyncs.layer, fresh.layer), eq(referenceDatasetSyncs.status, "active"))).limit(1);
    if (current) await tx.update(referenceDatasetSyncs).set({ status: "retired", retiredAt: new Date() }).where(eq(referenceDatasetSyncs.id, current.id));
    const [activated] = await tx.update(referenceDatasetSyncs).set({ status: "active", activatedAt: new Date(), retiredAt: null, previousActiveId: current?.id ?? fresh.previousActiveId }).where(eq(referenceDatasetSyncs.id, fresh.id)).returning();
    return activated;
  });
}

/** Re-activates the version that was active before the current one. */
export async function rollbackSource(db: Database, sourceKey: string, layer = "") {
  return db.transaction(async (tx) => {
    await lockSource(tx, sourceKey, layer);
    const current = await getActiveSync(tx, sourceKey, layer);
    if (!current?.previousActiveId) throw new Error("There is no earlier version to roll back to.");
    const [previous] = await tx.select().from(referenceDatasetSyncs).where(eq(referenceDatasetSyncs.id, current.previousActiveId)).limit(1);
    if (!previous || previous.status !== "retired") throw new Error("The earlier version is no longer available.");
    await tx.update(referenceDatasetSyncs).set({ status: "retired", retiredAt: new Date() }).where(and(eq(referenceDatasetSyncs.id, current.id), eq(referenceDatasetSyncs.status, "active")));
    const [restored] = await tx.update(referenceDatasetSyncs).set({ status: "active", activatedAt: new Date(), retiredAt: null }).where(and(eq(referenceDatasetSyncs.id, previous.id), eq(referenceDatasetSyncs.status, "retired"))).returning();
    if (!restored) throw new Error("Rollback could not be applied.");
    return restored;
  });
}

/** Keeps the newest `keep` retired versions for rollback and deletes older ones (rows cascade). */
export async function pruneRetiredSyncs(db: Database, sourceKey: string, keep = 2, layer = "") {
  const retired = await db.select({ id: referenceDatasetSyncs.id }).from(referenceDatasetSyncs).where(and(eq(referenceDatasetSyncs.sourceKey, sourceKey), eq(referenceDatasetSyncs.layer, layer), inArray(referenceDatasetSyncs.status, ["retired", "failed"]))).orderBy(desc(referenceDatasetSyncs.startedAt));
  const removable = retired.slice(keep).map((row) => row.id);
  if (removable.length) await db.delete(referenceDatasetSyncs).where(inArray(referenceDatasetSyncs.id, removable));
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
    await db.insert(referenceDataSources).values({ key: source.key, ...values }).onConflictDoUpdate({
      target: referenceDataSources.key,
      set: { ...values, ...(source.registerStatus === "blocked" ? { enabled: false } : {}) },
    });
    // Snapshots reference the England release's public.data_sources by key. Register any
    // key it does not already hold, disabled; existing rows (and their enablement) are untouched.
    await db.insert(dataSources).values({
      key: source.key, name: source.name, organisation: source.organisation, category: source.category, documentationUrl: source.documentationUrl,
      accessUrl: source.accessUrls[0]?.startsWith("http") ? source.accessUrls[0] : null, licence: source.licence.name, licenceUrl: source.licence.url ?? null,
      attribution: source.licence.attribution, coverageCountries: [...source.coverage], limitations: source.guardrail, accessRequirements: source.accessRequirements, enabled: false,
    }).onConflictDoNothing();
  }
  return sourceDefinitions.length;
}
