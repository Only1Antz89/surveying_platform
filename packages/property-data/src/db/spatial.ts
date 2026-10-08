import { and, eq, inArray, sql } from "drizzle-orm";
import { referenceDatasetSyncs, type Database, type TenantTransaction } from "@surveynt/db";
import type { SpatialQuery } from "../providers/types";

type Executor = Database | TenantTransaction;

/** Spatial lookups over active versions of imported reference layers. */
export function databaseSpatialQuery(db: Executor): SpatialQuery {
  return {
    async featuresAt(input) {
      const active = await db.select().from(referenceDatasetSyncs).where(and(eq(referenceDatasetSyncs.sourceKey, input.sourceKey), inArray(referenceDatasetSyncs.layer, input.layers), eq(referenceDatasetSyncs.status, "active")));
      const results = [];
      for (const layer of input.layers) {
        const sync = active.find((item) => item.layer === layer);
        if (!sync) {
          results.push({ layer, available: false, datasetVersion: null, sourceUpdatedAt: null, features: [] });
          continue;
        }
        const radius = Math.max(0, Math.min(input.nearbyMetres, 500));
        // Bounding-box prefilter in degrees (uses the GiST index), then exact metre distance on geography.
        const degrees = radius / 50_000 + 0.0001;
        const legacyDatasetVersionId = sync.validation.legacyBacked === true && typeof sync.validation.legacyDatasetVersionId === "string" ? sync.validation.legacyDatasetVersionId : null;
        const legacyLayer = typeof sync.validation.legacyLayer === "string" ? sync.validation.legacyLayer : layer;
        const rows = legacyDatasetVersionId ? await db.execute(sql`
          with origin as (select st_setsrid(st_makepoint(${input.longitude}, ${input.latitude}), 4326) as g), features as (
            select source_record_id as feature_id, name,
              properties || jsonb_build_object('legacySourceKey','historic_england','legacyDatasetVersionId',${legacyDatasetVersionId}::text,'legacyGeometryRepaired',not st_isvalid(geometry)) as attributes,
              case when st_isvalid(geometry) then geometry else st_makevalid(geometry) end as geom
            from public.spatial_reference_features
            where dataset_version_id = ${legacyDatasetVersionId}::uuid and source_key = 'historic_england'
              and coalesce(nullif(properties->>'layer',''), split_part(source_record_id, ':', 1), 'listed_building') = ${legacyLayer})
          select f.feature_id, f.name, f.attributes, st_intersects(f.geom, origin.g) as intersects,
            st_distance(f.geom::geography, origin.g::geography) as distance
          from features f, origin
          where f.geom && st_expand(origin.g, ${degrees})
            and (st_intersects(f.geom, origin.g) or st_dwithin(f.geom::geography, origin.g::geography, ${radius}))
          order by intersects desc, distance asc limit 50`) : await db.execute(sql`
          with origin as (select st_setsrid(st_makepoint(${input.longitude}, ${input.latitude}), 4326) as g)
          select f.feature_id, f.name, f.attributes, st_intersects(f.geom, origin.g) as intersects,
            st_distance(f.geom::geography, origin.g::geography) as distance
          from reference.spatial_features f, origin
          where f.dataset_sync_id = ${sync.id}
            and f.geom && st_expand(origin.g, ${degrees})
            and (st_intersects(f.geom, origin.g) or st_dwithin(f.geom::geography, origin.g::geography, ${radius}))
          order by intersects desc, distance asc
          limit 50`);
        const features = (rows as unknown as { rows: { feature_id: string; name: string | null; attributes: Record<string, unknown>; intersects: boolean; distance: number | string }[] }).rows;
        results.push({
          layer,
          available: true,
          datasetVersion: sync.datasetVersion,
          sourceUpdatedAt: sync.completedAt?.toISOString() ?? null,
          features: features.map((row) => ({ featureId: row.feature_id, name: row.name, attributes: row.attributes ?? {}, distanceMetres: Number(row.distance), intersects: Boolean(row.intersects) })),
        });
      }
      return results;
    },
  };
}

/** Bounded, simplified GeoJSON features around a point for map display (active version only). */
export async function featuresNear(db: Executor, input: { sourceKey: string; layer: string; latitude: number; longitude: number; radiusMetres: number; limit?: number }) {
  const [sync] = await db.select().from(referenceDatasetSyncs).where(and(eq(referenceDatasetSyncs.sourceKey, input.sourceKey), eq(referenceDatasetSyncs.layer, input.layer), eq(referenceDatasetSyncs.status, "active"))).limit(1);
  if (!sync) return null;
  const radius = Math.max(10, Math.min(input.radiusMetres, 1000));
  const latDegrees = radius / 111_000;
  const lonDegrees = radius / (111_000 * Math.cos((input.latitude * Math.PI) / 180));
  const legacyDatasetVersionId = sync.validation.legacyBacked === true && typeof sync.validation.legacyDatasetVersionId === "string" ? sync.validation.legacyDatasetVersionId : null;
  const legacyLayer = typeof sync.validation.legacyLayer === "string" ? sync.validation.legacyLayer : input.layer;
  const rows = legacyDatasetVersionId ? await db.execute(sql`
    select source_record_id as feature_id, name,
      properties || jsonb_build_object('legacySourceKey','historic_england','legacyDatasetVersionId',${legacyDatasetVersionId}::text,'legacyGeometryRepaired',not st_isvalid(geometry)) as attributes,
      st_asgeojson(st_simplifypreservetopology(case when st_isvalid(geometry) then geometry else st_makevalid(geometry) end, 0.000005), 6) as geometry
    from public.spatial_reference_features
    where dataset_version_id = ${legacyDatasetVersionId}::uuid and source_key = 'historic_england'
      and coalesce(nullif(properties->>'layer',''), split_part(source_record_id, ':', 1), 'listed_building') = ${legacyLayer}
      and geometry && st_makeenvelope(${input.longitude - lonDegrees}, ${input.latitude - latDegrees}, ${input.longitude + lonDegrees}, ${input.latitude + latDegrees}, 4326)
    limit ${Math.max(1, Math.min(input.limit ?? 200, 500))}`) : await db.execute(sql`
    select f.feature_id, f.name, f.attributes, st_asgeojson(st_simplifypreservetopology(f.geom, 0.000005), 6) as geometry
    from reference.spatial_features f
    where f.dataset_sync_id = ${sync.id}
      and f.geom && st_makeenvelope(${input.longitude - lonDegrees}, ${input.latitude - latDegrees}, ${input.longitude + lonDegrees}, ${input.latitude + latDegrees}, 4326)
    limit ${Math.max(1, Math.min(input.limit ?? 200, 500))}`);
  const features = (rows as unknown as { rows: { feature_id: string; name: string | null; attributes: Record<string, unknown>; geometry: string }[] }).rows;
  return {
    datasetVersion: sync.datasetVersion,
    featureCollection: { type: "FeatureCollection" as const, features: features.map((row) => ({ type: "Feature" as const, id: row.feature_id, properties: { name: row.name, ...row.attributes }, geometry: JSON.parse(row.geometry) as Record<string, unknown> })) },
  };
}
