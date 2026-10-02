import { and, desc, eq, inArray } from "drizzle-orm";
import { dataSources, datasetSyncs, providerResponseCache, type Database } from "@surveynt/db";
import { sourceFreshness } from "../operations/freshness";
import type { ProbeResult } from "../operations/probes";
import { getSourceDefinition, sourceDefinitions } from "../registry/sources";
import { activateSync, rollbackSource } from "./reference";

// Operator actions on the reference registry. They run on the owner
// connection (platform administration), never on the tenant runtime role.

export type SourceOperationsView = Awaited<ReturnType<typeof loadSourceOperations>>[number];

export async function loadSourceOperations(db: Database, now = new Date()) {
  const [rows, syncs] = await Promise.all([
    db.select().from(dataSources),
    db.select().from(datasetSyncs).orderBy(desc(datasetSyncs.startedAt)).limit(2000),
  ]);
  return sourceDefinitions.map((definition) => {
    const row = rows.find((item) => item.key === definition.key) ?? null;
    const history = syncs.filter((sync) => sync.sourceKey === definition.key);
    const active = history.filter((sync) => sync.status === "active");
    const freshness = sourceFreshness(definition, { activeActivatedAt: active.map((sync) => sync.activatedAt ?? sync.completedAt ?? sync.startedAt), lastReleaseCheckAt: row?.lastReleaseCheckAt ?? null, now });
    return {
      key: definition.key, name: definition.name, organisation: definition.organisation, category: definition.category, accessMethod: definition.accessMethod,
      registerStatus: definition.registerStatus, coverage: definition.coverage, documentationUrl: definition.documentationUrl, refreshDays: definition.refreshPolicy.days, guardrail: definition.guardrail,
      registered: Boolean(row), enabled: Boolean(row?.enabled && row.verifiedAt && definition.registerStatus !== "blocked"),
      verifiedAt: row?.verifiedAt?.toISOString() ?? null, verifiedBy: row?.verifiedBy ?? null, verificationNotes: row?.verificationNotes ?? null,
      probe: row?.lastProbeAt ? { at: row.lastProbeAt.toISOString(), status: row.lastProbeStatus, message: row.lastProbeMessage } : null,
      releaseCheck: row?.lastReleaseCheckAt ? { at: row.lastReleaseCheckAt.toISOString(), by: row.lastReleaseCheckBy, note: row.lastReleaseCheckNote } : null,
      freshness,
      active: active.map((sync) => ({ id: sync.id, layer: sync.layer, datasetVersion: sync.datasetVersion, recordCount: sync.recordCount, activatedAt: sync.activatedAt?.toISOString() ?? null })),
      history: history.slice(0, 20).map((sync) => ({
        id: sync.id, layer: sync.layer, datasetVersion: sync.datasetVersion, status: sync.status, recordCount: sync.recordCount, extent: sync.extent, importedBy: sync.importedBy,
        startedAt: sync.startedAt.toISOString(), completedAt: sync.completedAt?.toISOString() ?? null, activatedAt: sync.activatedAt?.toISOString() ?? null, error: sync.error, validation: sync.validation,
      })),
    };
  });
}

export class OperationRefused extends Error {}

/** Enabling records who verified the source's terms and what they checked. Blocked sources cannot be enabled. */
export async function setSourceEnablement(db: Database, key: string, input: { enabled: boolean; actor: string; notes?: string | null }) {
  const definition = getSourceDefinition(key);
  if (!definition) throw new OperationRefused("Unknown source.");
  if (input.enabled && definition.registerStatus === "blocked") throw new OperationRefused("This source is blocked in the source register (licence or access) and cannot be enabled.");
  if (input.enabled && (input.notes?.trim().length ?? 0) < 20) throw new OperationRefused("Record what was verified (licence, terms, endpoint, date) in at least 20 characters.");
  const [updated] = await db.update(dataSources).set(input.enabled
    ? { enabled: true, verifiedAt: new Date(), verifiedBy: input.actor, verificationNotes: input.notes!.trim(), updatedAt: new Date() }
    : { enabled: false, updatedAt: new Date() }).where(eq(dataSources.key, key)).returning({ key: dataSources.key });
  if (!updated) throw new OperationRefused("Run the registry sync before enabling this source.");
  return updated;
}

export async function recordReleaseCheck(db: Database, key: string, input: { actor: string; note: string }) {
  if (input.note.trim().length < 10) throw new OperationRefused("Say what was checked (at least 10 characters).");
  const [updated] = await db.update(dataSources).set({ lastReleaseCheckAt: new Date(), lastReleaseCheckBy: input.actor, lastReleaseCheckNote: input.note.trim(), updatedAt: new Date() }).where(eq(dataSources.key, key)).returning({ key: dataSources.key });
  if (!updated) throw new OperationRefused("Unknown or unregistered source.");
  return updated;
}

export async function recordProbe(db: Database, key: string, result: ProbeResult) {
  const at = new Date();
  await db.update(dataSources).set({
    lastProbeAt: at, lastProbeStatus: result.status, lastProbeMessage: result.message.slice(0, 300),
    ...(result.status === "ok" ? { lastSuccessAt: at } : result.status === "failed" ? { lastFailureAt: at, lastFailureCode: result.message.slice(0, 60) } : {}),
    updatedAt: at,
  }).where(eq(dataSources.key, key));
}

/** Removes cached public responses for a source so the next request uses the newly active data. */
export async function invalidateSourceCache(db: Database, key: string) {
  const removed = await db.delete(providerResponseCache).where(eq(providerResponseCache.sourceKey, key)).returning({ key: providerResponseCache.cacheKey });
  return removed.length;
}

export async function activateSyncAndInvalidate(db: Database, syncId: string) {
  const activated = await activateSync(db, syncId);
  const invalidated = await invalidateSourceCache(db, activated.sourceKey);
  return { activated, invalidated };
}

export async function rollbackAndInvalidate(db: Database, key: string, layer = "") {
  const restored = await rollbackSource(db, key, layer);
  const invalidated = await invalidateSourceCache(db, key);
  return { restored, invalidated };
}

export async function staleSources(db: Database, now = new Date()) {
  const view = await loadSourceOperations(db, now);
  return view.filter((source) => source.enabled && source.freshness.state === "release_check_due").map((source) => ({ key: source.key, dueAt: source.freshness.dueAt }));
}

export async function sourcesToProbe(db: Database) {
  const rows = await db.select({ key: dataSources.key }).from(dataSources).where(and(eq(dataSources.enabled, true), inArray(dataSources.key, ["postcodes_io", "planning_data"])));
  return rows.map((row) => row.key);
}
