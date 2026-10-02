# Property intelligence operations

## Required configuration

- `DATABASE_APP_URL` and `DATABASE_ADMIN_URL`
- `QUEUE_CONSUMER_SECRET` or `CRON_SECRET`
- `NOMINATIM_BASE_URL` and a contactable `NOMINATIM_USER_AGENT` to enable submitted geocoding. The public OSM endpoint additionally requires the existing Upstash REST configuration so its deployment-wide request limit can be enforced; a hosted or self-managed compatible provider may use its own service policy.
- `ADDRESS_SEARCH_CACHE_TTL_SECONDS` optionally controls the tenant-scoped submitted-search cache (default one day; clamped between one minute and seven days).
- `EPC_API_EMAIL`, `EPC_API_KEY` and optional `EPC_API_BASE_URL` after licence acceptance
- `NEXT_PUBLIC_MAP_STYLE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` before production map launch

## Import procedure

Run the read-only database gate first with `pnpm --filter @surveynt/db check:property-data-capabilities`. It reports PostGIS availability, role separation and whether the property-intelligence tables already exist without installing extensions or changing schema.

The 1 October 2026 non-production migration installed PostGIS 3.6.4 on PostgreSQL 18.6. The post-migration audit confirmed separate application and administrator roles, application-role spatial-function access, readable source metadata, denied reference-table writes, tenant isolation against a guessed organisation ID, all required RLS policies, and the immutable-snapshot trigger. Run `pnpm --filter @surveynt/db verify:property-data-security` after future permission or migration changes.

Run `pnpm --filter @surveynt/db verify:property-data-spatial` after PostGIS or spatial-index changes. It uses temporary versioned fixtures to check metre-based nearby-UPRN ambiguity, inside/outside/boundary intersections and EPSG:27700 to EPSG:4326 transformation, then verifies complete fixture removal.

1. Obtain the official release and record its licence, publication date and source URL.
2. Convert source data to UTF-8 CSV. OS Open UPRN headers must include `uprn,latitude,longitude`; other layers require `source_record_id,wkt` with optional `name,properties_json`. Declare either `--source-crs EPSG:4326` or `--source-crs EPSG:27700`; unsupported or omitted CRS values are rejected and BNG geometries are transformed to WGS84 during staging.
3. Run `pnpm --filter @surveynt/db import:property-data -- --source ... --version ... --file ... --source-url ... --source-crs ... --neon-storage-usd-per-gb-month ... --dry-run true`.

For an official GeoJSON release, first create the canonical spatial CSV without changing the database:

`pnpm --filter @surveynt/db prepare:spatial-geojson -- --output /private/tmp/source.csv --source-crs EPSG:4326 --input listed_building=/path/listed.geojson --input scheduled_monument=/path/scheduled.geojson`

Each repeated input must have a stable, unique label. The preparer prefixes source identifiers with that label, converts supported GeoJSON geometry to WKT, preserves source properties, and records the designation type. It refuses non-WGS84 declarations, missing geometry, missing identifiers, duplicate labels, and existing output files.

For HMLR INSPIRE GML, extract each downloaded authority archive and prepare the national file with:

`pnpm --filter @surveynt/db prepare:spatial-gml -- --output /private/tmp/hmlr.csv --source-crs EPSG:27700 --input adur=/path/Land_Registry_Cadastral_Parcels.gml --input amber_valley=/path/Land_Registry_Cadastral_Parcels.gml`

The GML preparer streams each authority file, requires British National Grid polygons, retains INSPIRE provenance, marks boundaries as indicative and non-definitive, and deduplicates INSPIRE identifiers repeated across local-authority boundaries.
4. Review record count, bounded row diagnostics, duplicate or missing headers, invalid UPRNs/coordinates/geometries, file bytes, estimated table bytes and projected storage cost. Empty or semantically invalid files do not reach staging.
5. Import without `--activate` using `--expected-checksum ... --licence-confirmed true --neon-storage-usd-per-gb-month ...`. All three gates are mandatory for a staged import. Review the measured table/index size and sample spatial-query latency printed and stored with the version.
6. Activate the staged version with `pnpm --filter @surveynt/db activate:property-data -- --source ... --version ... --capacity-approved true`. The command rejects versions without a verified checksum, recorded licence confirmation and measured capacity report, then switches the active version atomically. An existing version is never overwritten.
7. Confirm application-role writes fail and property-centred queries return only bounded features.

The importer deletes a failed staged version and retains the previously active version. Dataset sync rows retain the safe failure reason. Roll back with `pnpm --filter @surveynt/db rollback:property-data -- --source ... --version ...`; it accepts only a previously validated, non-empty, capacity-approved version and records a `rolled_back` sync.

## Queue operations

Refresh requests return `202` and a run ID. Schedule the protected worker endpoint at a deployment-supported interval. Jobs use exponential backoff up to five attempts. Identity changes are terminal for the old run; request a new refresh after reviewing the property.

Run `pnpm --filter @surveynt/web verify:property-worker` with the repository environment loaded to verify that the deployed route rejects an invalid token and can process the current queue using the configured worker secret.

## Provider smoke checks

Run `pnpm --filter @surveynt/property-data verify:providers` to validate the public Postcodes.io and Planning Data adapters against the labelled Bristol development fixture. It does not persist results and treats Planning Data `no_match` only as an empty response from the queried datasets. Nominatim and EPC require their deployment configuration before separate live verification.
