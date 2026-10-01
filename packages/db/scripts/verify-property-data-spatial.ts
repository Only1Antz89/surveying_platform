import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createDatabase, datasetVersions } from "../src/index";

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function main() {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const uprnVersionId = randomUUID();
  const spatialVersionId = randomUUID();
  const suffix = randomUUID();
  let cleanupVerified = false;

  try {
    await db.insert(datasetVersions).values([
      { id: uprnVersionId, sourceKey: "os_open_uprn", version: `spatial-test-${suffix}`, checksum: "0".repeat(64), sourceUrl: "https://example.test/spatial-verification", licenceSnapshot: { testFixture: true } },
      { id: spatialVersionId, sourceKey: "historic_england", version: `spatial-test-${suffix}`, checksum: "1".repeat(64), sourceUrl: "https://example.test/spatial-verification", licenceSnapshot: { testFixture: true } },
    ]);
    await db.execute(sql`insert into os_uprn_points (dataset_version_id, uprn, location) values
      (${uprnVersionId}, '900000000001', ST_SetSRID(ST_MakePoint(-2.620000, 51.458900), 4326)),
      (${uprnVersionId}, '900000000002', ST_SetSRID(ST_MakePoint(-2.619980, 51.458900), 4326)),
      (${uprnVersionId}, '900000000003', ST_SetSRID(ST_MakePoint(-2.610000, 51.458900), 4326))`);
    await db.execute(sql`insert into spatial_reference_features (dataset_version_id, source_key, source_record_id, name, geometry, properties) values
      (${spatialVersionId}, 'historic_england', 'inside', 'Inside fixture', ST_GeomFromText('POLYGON((-2.621 51.458,-2.619 51.458,-2.619 51.460,-2.621 51.460,-2.621 51.458))', 4326), '{"fixture":true}'::jsonb),
      (${spatialVersionId}, 'historic_england', 'outside', 'Outside fixture', ST_GeomFromText('POLYGON((-2.611 51.458,-2.609 51.458,-2.609 51.460,-2.611 51.460,-2.611 51.458))', 4326), '{"fixture":true}'::jsonb),
      (${spatialVersionId}, 'historic_england', 'boundary', 'Boundary fixture', ST_GeomFromText('POLYGON((-2.620 51.458,-2.618 51.458,-2.618 51.460,-2.620 51.460,-2.620 51.458))', 4326), '{"fixture":true}'::jsonb)`);

    const [nearby, intersections, transformed] = await Promise.all([
      db.execute(sql`select uprn, ST_Distance(location::geography, ST_SetSRID(ST_MakePoint(-2.620000, 51.458900), 4326)::geography) as distance_metres from os_uprn_points where dataset_version_id = ${uprnVersionId} and ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(-2.620000, 51.458900), 4326)::geography, 75) order by distance_metres`),
      db.execute(sql`select source_record_id, ST_Intersects(geometry, ST_SetSRID(ST_MakePoint(-2.620000, 51.458900), 4326)) as intersects from spatial_reference_features where dataset_version_id = ${spatialVersionId} order by source_record_id`),
      db.execute(sql`select ST_SRID(value) as srid, ST_X(value) as longitude, ST_Y(value) as latitude from (select ST_Transform(ST_SetSRID(ST_MakePoint(358000, 173000), 27700), 4326) as value) transformed`),
    ]);

    const nearbyRows = nearby.rows as Array<{ uprn: string; distance_metres: string | number }>;
    const intersectionMap = new Map((intersections.rows as Array<{ source_record_id: string; intersects: unknown }>).map((row) => [row.source_record_id, booleanValue(row.intersects)]));
    const transformedPoint = transformed.rows[0] as { srid?: string | number; longitude?: string | number; latitude?: string | number } | undefined;
    const ambiguousNearbyCandidates = nearbyRows.length === 2 && nearbyRows.every((row) => Number(row.distance_metres) >= 0 && Number(row.distance_metres) < 75);
    const insideIntersection = intersectionMap.get("inside") === true;
    const outsideExcluded = intersectionMap.get("outside") === false;
    const boundaryIntersection = intersectionMap.get("boundary") === true;
    const bngTransformationValid = Number(transformedPoint?.srid) === 4326 && Number(transformedPoint?.longitude) > -8 && Number(transformedPoint?.longitude) < 2 && Number(transformedPoint?.latitude) > 49 && Number(transformedPoint?.latitude) < 56;
    if (!ambiguousNearbyCandidates || !insideIntersection || !outsideExcluded || !boundaryIntersection || !bngTransformationValid) throw new Error("One or more spatial verification assertions failed.");

    console.log(JSON.stringify({ ambiguousNearbyCandidates, nearbyCandidateCount: nearbyRows.length, insideIntersection, outsideExcluded, boundaryIntersection, bngTransformationValid, transformedPoint: { srid: Number(transformedPoint?.srid), longitude: Number(transformedPoint?.longitude).toFixed(6), latitude: Number(transformedPoint?.latitude).toFixed(6) } }, null, 2));
  } finally {
    await db.delete(datasetVersions).where(eq(datasetVersions.id, uprnVersionId));
    await db.delete(datasetVersions).where(eq(datasetVersions.id, spatialVersionId));
    const remaining = await db.execute(sql`select count(*)::int as count from dataset_versions where id in (${uprnVersionId}, ${spatialVersionId})`);
    cleanupVerified = Number((remaining.rows[0] as { count?: number } | undefined)?.count ?? -1) === 0;
    if (!cleanupVerified) throw new Error("Temporary spatial fixtures were not fully removed.");
  }
  console.log(JSON.stringify({ fixtureCleanupVerified: cleanupVerified }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
