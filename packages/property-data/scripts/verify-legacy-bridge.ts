import { and, eq, sql } from "drizzle-orm";
import { createDatabase, referenceDataSources, referenceDatasetSyncs } from "@surveynt/db";
import { databaseSpatialQuery } from "../src/db/spatial";

async function main() {
  if (!process.env.DATABASE_APP_URL || !process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_APP_URL and DATABASE_ADMIN_URL are required.");
  const admin = createDatabase(process.env.DATABASE_ADMIN_URL); const app = createDatabase(process.env.DATABASE_APP_URL);
  const [source] = await admin.select().from(referenceDataSources).where(eq(referenceDataSources.key, "historic_england_nhle")).limit(1);
  const active = await admin.select().from(referenceDatasetSyncs).where(and(eq(referenceDatasetSyncs.sourceKey, "historic_england_nhle"), eq(referenceDatasetSyncs.status, "active")));
  if (!source?.enabled || !source.verifiedAt || active.length !== 8) throw new Error("Historic England source or active layers are incomplete.");
  const spatial = databaseSpatialQuery(app); const samples = [];
  for (const sync of active) {
    const legacyId = String(sync.validation.legacyDatasetVersionId ?? ""); const legacyLayer = String(sync.validation.legacyLayer ?? "");
    if (!legacyId || !legacyLayer) throw new Error(`Layer ${sync.layer} is missing legacy provenance.`);
    const point = await admin.execute(sql`select st_x(st_pointonsurface(geometry)) as longitude, st_y(st_pointonsurface(geometry)) as latitude from public.spatial_reference_features where dataset_version_id = ${legacyId}::uuid and coalesce(nullif(properties->>'layer',''), split_part(source_record_id, ':', 1), 'listed_building') = ${legacyLayer} limit 1`);
    const row = point.rows[0] as { latitude?: number | string; longitude?: number | string } | undefined; if (!row) throw new Error(`Layer ${sync.layer} has no sample.`);
    const result = (await spatial.featuresAt({ sourceKey: "historic_england_nhle", layers: [sync.layer], latitude: Number(row.latitude), longitude: Number(row.longitude), nearbyMetres: 0 }))[0];
    if (!result?.available || !result.features.some((feature) => feature.intersects)) throw new Error(`Application-role query failed for ${sync.layer}.`);
    samples.push({ layer: sync.layer, recordCount: sync.recordCount, matched: result.features.length });
  }
  const recordCount = active.reduce((sum, sync) => sum + sync.recordCount, 0); if (recordCount !== 401_771) throw new Error(`Expected 401771 records, found ${recordCount}.`);
  console.log(JSON.stringify({ sourceEnabled: true, activeLayers: active.length, recordCount, samples }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
