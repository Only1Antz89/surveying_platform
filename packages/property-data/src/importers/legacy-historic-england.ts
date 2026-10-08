import { sql } from "drizzle-orm";
import type { Database } from "@surveynt/db";
import { syncSourceRegistry } from "../db/reference";

const sourceKey = "historic_england_nhle";
const layerAliases: Record<string, string> = {
  listed_buildings: "listed_building",
  scheduled_monuments: "scheduled_monument",
  registered_parks_and_gardens: "registered_park_garden",
  registered_battlefields: "registered_battlefield",
  battlefield: "registered_battlefield",
  park_garden: "registered_park_garden",
  park_and_garden: "registered_park_garden",
  parks_and_gardens: "registered_park_garden",
  world_heritage_sites: "world_heritage_site",
  protected_wreck_sites: "protected_wreck_site",
  certificates_of_immunity: "certificate_of_immunity",
  building_preservation_notices: "building_preservation_notice",
};

type LayerRow = { layer: string; record_count: number | string };

/**
 * One-time, idempotent bridge from the first England release into the canonical
 * reference schema. All layers are validated before a single transaction swaps
 * the active versions, so a failed bridge leaves the current reference data intact.
 */
export async function bridgeLegacyHistoricEngland(db: Database, importedBy = "operator", options: { legacyReference?: boolean } = {}) {
  await syncSourceRegistry(db);
  return db.transaction(async (tx) => {
    const legacy = await tx.execute(sql`
      select id, version, checksum, source_url, licence_snapshot, record_count, validation, activated_at
      from public.dataset_versions
      where source_key = 'historic_england' and active = true
      order by activated_at desc nulls last limit 1`);
    const version = (legacy as unknown as { rows: Array<Record<string, unknown>> }).rows[0];
    if (!version) throw new Error("No active legacy Historic England dataset is available to bridge.");

    const grouped = await tx.execute(sql`
      select coalesce(nullif(properties->>'layer',''), split_part(source_record_id, ':', 1), 'listed_building') as layer,
             count(*)::integer as record_count
      from public.spatial_reference_features
      where dataset_version_id = ${String(version.id)}::uuid and source_key = 'historic_england'
      group by 1 order by 1`);
    const layers = (grouped as unknown as { rows: LayerRow[] }).rows;
    if (!layers.length) throw new Error("The active legacy Historic England dataset contains no features.");

    const staged: Array<{ id: string; layer: string; count: number }> = [];
    for (const item of layers) {
      const layer = layerAliases[item.layer] ?? item.layer;
      const currentResult = await tx.execute(sql`select id from reference.dataset_syncs where source_key = ${sourceKey} and layer = ${layer} and status = 'active' limit 1`);
      const current = (currentResult as unknown as { rows: Array<{ id: string }> }).rows[0];
      const existing = await tx.execute(sql`
        select id, record_count from reference.dataset_syncs
        where source_key = ${sourceKey} and layer = ${layer} and dataset_version = ${String(version.version)}
          and validation->>'legacyDatasetVersionId' = ${String(version.id)} limit 1`);
      const found = (existing as unknown as { rows: Array<{ id: string; record_count: number }> }).rows[0];
      if (found) {
        await tx.execute(sql`update reference.dataset_syncs set previous_active_id = coalesce(previous_active_id, ${current?.id ?? null}::uuid) where id = ${found.id}::uuid`);
        staged.push({ id: found.id, layer, count: Number(found.record_count) }); continue;
      }

      const inserted = await tx.execute(sql`
        insert into reference.dataset_syncs
          (source_key, layer, dataset_version, source_url, checksum, licence, source_crs, status, imported_by, previous_active_id)
        values (${sourceKey}, ${layer}, ${String(version.version)}, ${String(version.source_url ?? "")}, ${String(version.checksum ?? "")},
          ${JSON.stringify(version.licence_snapshot ?? {})}::jsonb, 'EPSG:4326', 'staging', ${importedBy}, ${current?.id ?? null}::uuid)
        returning id`);
      const syncId = (inserted as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
      if (!options.legacyReference) await tx.execute(sql`
          insert into reference.spatial_features (dataset_sync_id, source_key, layer, feature_id, name, attributes, geom)
          select ${syncId}::uuid, ${sourceKey}, ${layer}, source_record_id, name,
            properties || jsonb_build_object('legacySourceKey','historic_england','legacyDatasetVersionId',${String(version.id)}::text,'legacyGeometryRepaired',not st_isvalid(geometry)),
            case when st_isvalid(geometry) then geometry else st_makevalid(geometry) end
          from public.spatial_reference_features
          where dataset_version_id = ${String(version.id)}::uuid and source_key = 'historic_england'
            and coalesce(nullif(properties->>'layer',''), split_part(source_record_id, ':', 1), 'listed_building') = ${item.layer}`);
      const validation = options.legacyReference ? await tx.execute(sql`
          select count(*)::integer as count,
            count(*) filter (where geometry is null or not st_isvalid(geometry))::integer as invalid,
            count(*) filter (where geometry is null or not st_isvalid(case when st_isvalid(geometry) then geometry else st_makevalid(geometry) end))::integer as unrepaired
          from public.spatial_reference_features where dataset_version_id = ${String(version.id)}::uuid and source_key = 'historic_england'
            and coalesce(nullif(properties->>'layer',''), split_part(source_record_id, ':', 1), 'listed_building') = ${item.layer}`) : await tx.execute(sql`
          select count(*)::integer as count, count(*) filter (where geom is null or not st_isvalid(geom))::integer as invalid, 0::integer as unrepaired
          from reference.spatial_features where dataset_sync_id = ${syncId}::uuid`);
      const checked = (validation as unknown as { rows: Array<{ count: number; invalid: number; unrepaired: number }> }).rows[0]!;
      if (Number(checked.count) !== Number(item.record_count) || Number(checked.unrepaired) !== 0) throw new Error(`Validation failed for ${layer}: expected ${item.record_count}, available ${checked.count}, unrepaired ${checked.unrepaired}.`);
      const sample = options.legacyReference ? await tx.execute(sql`select source_record_id as feature_id from public.spatial_reference_features where dataset_version_id = ${String(version.id)}::uuid and source_key = 'historic_england' and coalesce(nullif(properties->>'layer',''), split_part(source_record_id, ':', 1), 'listed_building') = ${item.layer} and geometry && st_makeenvelope(-6, 49, 2, 56, 4326) limit 1`) : await tx.execute(sql`select feature_id from reference.spatial_features where dataset_sync_id = ${syncId}::uuid and geom && st_makeenvelope(-6, 49, 2, 56, 4326) limit 1`);
      if (!(sample as unknown as { rows: Array<{ feature_id: string }> }).rows[0]) throw new Error(`Sample spatial query failed for ${layer}.`);
      await tx.execute(sql`update reference.dataset_syncs set record_count = ${Number(checked.count)}, completed_at = now(), validation = ${JSON.stringify({ legacyDatasetVersionId: version.id, legacyLayer: item.layer, legacyValidation: version.validation ?? {}, legacyActivatedAt: version.activated_at ?? null, legacyBacked: Boolean(options.legacyReference), originalInvalidGeometries: Number(checked.invalid), geometryValidAtQueryBoundary: true, sampleQueryValid: true })}::jsonb where id = ${syncId}::uuid`);
      staged.push({ id: syncId, layer, count: Number(checked.count) });
    }

    const stagedIds = staged.map((item) => item.id);
    const idList = sql.join(stagedIds.map((id) => sql`${id}::uuid`), sql`, `);
    await tx.execute(sql`update reference.dataset_syncs set status = 'retired', retired_at = now() where source_key = ${sourceKey} and status = 'active' and id not in (${idList})`);
    await tx.execute(sql`update reference.dataset_syncs set status = 'active', activated_at = coalesce(activated_at, now()), retired_at = null where id in (${idList})`);
    await tx.execute(sql`update reference.data_sources set last_success_at = now(), updated_at = now() where key = ${sourceKey}`);
    await tx.execute(sql`insert into public.audit_events (action, resource_type, resource_id, metadata) values ('data_source.legacy_bridge_activated', 'data_source', ${sourceKey}, ${JSON.stringify({ importedBy, legacyDatasetVersionId: version.id, datasetVersion: version.version, layers: staged, recordCount: staged.reduce((sum, item) => sum + item.count, 0) })}::jsonb)`);
    return { sourceKey, datasetVersion: String(version.version), layers: staged, recordCount: staged.reduce((sum, item) => sum + item.count, 0) };
  });
}
