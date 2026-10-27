# Property and land data: database optimisation, 21 October 2026

Measured on a local PostgreSQL 16 and PostGIS 3.4 copy built from all repository migrations, with synthetic data at production scale. Production itself was not queried or changed.

## 1. Heritage lookups no longer scan every row (fixed in this change)

The active Historic England layer (about 400,000 polygons) is served from `public.spatial_reference_features` through the legacy bridge in `packages/property-data/src/db/spatial.ts`. That query repaired each geometry (`st_isvalid` / `st_makevalid`) before applying the bounding-box filter. The filter therefore ran on a computed value, the spatial index could not be used, and every property check validated all 400,000 shapes.

| Query | Plan | Time (400,000 polygons) |
| --- | --- | --- |
| Before | Parallel sequential scan, `st_isvalid` on every row | 643 ms |
| After | Index scan on `spatial_reference_geometry_gix`, repair only for nearby shapes | 6.6 ms |

The fix adds the same bounding-box test on the stored geometry inside the query. Repairing a shape never moves it outside its original bounding box, so results are unchanged. No migration is needed.

## 2. Storage is the binding limit, not speed

The Neon project has a 1,024 MB limit. The 2 October capacity report recorded the shared spatial table at 781 MB after the failed flood-zone import was removed. The live Historic England data (about 434 MB) sits in a different table, so much of that 781 MB is likely dead space.

- **Reclaim the dead space.** Run `VACUUM FULL` (or `pg_repack`) on the shared spatial table in a short maintenance window. It locks that table while it runs, so lookups that use it pause. This is likely the biggest single gain, possibly several hundred MB. It changes production, so it needs your go-ahead.
- **Check usage first.** `pnpm --filter @surveynt/db check:production` is read-only. It reports database size against the limit, plus the largest tables and their dead rows, so the exact saving is known before any maintenance.

## 3. National datasets do not fit the current plan

| Dataset | Rows | Current design | Compact design* | Fits 1 GB? |
| --- | ---: | ---: | ---: | --- |
| OS Open UPRN (GB) | 41.7 M | ~9.6 GB | ~5.5 GB | No |
| EA Flood Zone 2 | 540 k | ~8.3 GB (estimate) | n/a | No |
| EA Flood Zone 3 | 273 k | ~8.4 GB (estimate) | n/a | No |
| HMLR INSPIRE (England) | not yet counted | ~52 GB (estimate) | n/a | No |

\*Measured on 1 million synthetic rows: dropping the two source-coordinate columns and storing the UPRN as `bigint` with a plain point index cuts table plus index size by 43% (231 MB to 133 MB per million rows). That still leaves the national file far above 1 GB, so no schema change is proposed until the plan changes.

Options, cheapest first:

1. **Stay on the current plan.** Keep UPRN, flood and land extents as on-demand lookups (postcode-level matching, OGC API calls for flood zones) and keep only Historic England stored. No cost change.
2. **Upgrade Neon storage** (published rate USD 0.35 per GiB-month). Flood zones 2 and 3 would add about USD 6 a month. They should be imported split into pieces (`ST_Subdivide`, 256 vertices) so point lookups stay fast on very large polygons. UPRN in the compact design would add about USD 2 a month.
3. **A separate reference database** for the national layers, keeping tenant data on the current project.

## 4. Terrain

Terrain is not stored in the database. The fieldwork map streams a raster elevation tile service (`NEXT_PUBLIC_FIELD_TERRAIN_URL`, Terrarium encoding) directly to the browser. That is the right design, and it costs no database storage. Production has no terrain URL set, so the 3D terrain view is off there. Add an approved, attributed tile service URL and `NEXT_PUBLIC_FIELD_TERRAIN_ATTRIBUTION` to switch it on.

## 5. Tenant property tables

`properties` already has tenant, client, UPRN and spatial indexes, and every lookup is scoped by organisation. At practice scale (thousands of rows) these queries are index lookups, and no change is needed.
