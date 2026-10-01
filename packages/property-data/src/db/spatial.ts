import { and, eq, inArray, sql } from "drizzle-orm";
import { datasetSyncs, type Database, type TenantTransaction } from "@surveynt/db";
import type { SpatialQuery } from "../providers/types";

type Executor = Database | TenantTransaction;

/** Spatial lookups over active versions of imported reference layers. */
export function databaseSpatialQuery(db: Executor): SpatialQuery {
  return {
    async featuresAt(input) {
      const active = await db.select().from(datasetSyncs).where(and(eq(datasetSyncs.sourceKey, input.sourceKey), inArray(datasetSyncs.layer, input.layers), eq(datasetSyncs.status, "active")));
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
        const rows = await db.execute(sql`
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
