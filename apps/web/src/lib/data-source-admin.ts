import { auditEvents, createDatabase } from "@surveynt/db";
import { sourceDefinitions, sourceFreshness } from "@surveynt/property-data";
import { activateSyncAndInvalidate, loadSourceOperations, OperationRefused, probeSource, recordProbe, recordReleaseCheck, rollbackAndInvalidate, setSourceEnablement, sourcesToProbe, staleSources, type SourceOperationsView } from "@surveynt/property-data/importers";

export type DataSourceAction = { action: "enable"; notes: string } | { action: "disable" } | { action: "release_checked"; notes: string } | { action: "probe" } | { action: "rollback"; layer: string };
export type Operator = { platformStaffId: string; userId: string };

export const canOperateDataSources = (role: string) => role === "super_admin" || role === "compliance";

function adminDb() {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for data source administration.");
  return createDatabase(process.env.DATABASE_ADMIN_URL);
}

/** Registry-only view for the demo workspace: nothing imported, nothing enabled. */
export function demoDataSourceView(): SourceOperationsView[] {
  const now = new Date();
  return sourceDefinitions.map((definition) => ({
    key: definition.key, name: definition.name, organisation: definition.organisation, category: definition.category, accessMethod: definition.accessMethod,
    registerStatus: definition.registerStatus, coverage: definition.coverage, documentationUrl: definition.documentationUrl, refreshDays: definition.refreshPolicy.days, guardrail: definition.guardrail,
    registered: false, enabled: false, verifiedAt: null, verifiedBy: null, verificationNotes: null, probe: null, releaseCheck: null,
    freshness: sourceFreshness(definition, { activeActivatedAt: [], lastReleaseCheckAt: null, now }), active: [], history: [],
  }));
}

export async function loadDataSourceAdmin() {
  return loadSourceOperations(adminDb());
}

async function audit(operator: Operator, action: string, resourceId: string, metadata: Record<string, unknown>) {
  await adminDb().insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action, resourceType: "data_source", resourceId, metadata });
}

/** Applies one operator action and records it in the platform audit trail. */
export async function applyDataSourceAction(operator: Operator, key: string, input: DataSourceAction) {
  const db = adminDb();
  const actor = `platform:${operator.platformStaffId}`;
  switch (input.action) {
    case "enable": await setSourceEnablement(db, key, { enabled: true, actor, notes: input.notes }); break;
    case "disable": await setSourceEnablement(db, key, { enabled: false, actor }); break;
    case "release_checked": await recordReleaseCheck(db, key, { actor, note: input.notes }); break;
    case "probe": {
      const result = await probeSource(key, process.env);
      await recordProbe(db, key, result);
      await audit(operator, "data_source.probed", key, { status: result.status, durationMs: result.durationMs });
      return { probe: result };
    }
    case "rollback": {
      const { restored, invalidated } = await rollbackAndInvalidate(db, key, input.layer);
      await audit(operator, "data_source.rolled_back", key, { layer: input.layer, restoredSyncId: restored.id, datasetVersion: restored.datasetVersion, cacheEntriesRemoved: invalidated });
      return { restored: { id: restored.id, datasetVersion: restored.datasetVersion }, invalidated };
    }
  }
  await audit(operator, `data_source.${input.action}`, key, input.action === "disable" ? {} : { notes: input.notes });
  return {};
}

export async function activateDataSourceSync(operator: Operator, syncId: string) {
  const { activated, invalidated } = await activateSyncAndInvalidate(adminDb(), syncId);
  await audit(operator, "data_source.version_activated", activated.sourceKey, { syncId, layer: activated.layer, datasetVersion: activated.datasetVersion, cacheEntriesRemoved: invalidated });
  return { activated: { id: activated.id, sourceKey: activated.sourceKey, datasetVersion: activated.datasetVersion }, invalidated };
}

/** Daily operations sweep: probe enabled live APIs and list imported sources due a release check. */
export async function runDataSourceSweep() {
  if (!process.env.DATABASE_ADMIN_URL) return { probed: 0, stale: [] as { key: string; dueAt: string | null }[] };
  const db = adminDb();
  let probed = 0;
  for (const key of await sourcesToProbe(db)) {
    await recordProbe(db, key, await probeSource(key, process.env));
    probed += 1;
  }
  return { probed, stale: await staleSources(db) };
}

export { OperationRefused };
