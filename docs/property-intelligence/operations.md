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

1. Obtain the official release and record its licence, publication date and source URL.
2. Convert source data to UTF-8 CSV. OS Open UPRN headers must include `uprn,latitude,longitude`; other layers require `source_record_id,wkt` with optional `name,properties_json`. Declare either `--source-crs EPSG:4326` or `--source-crs EPSG:27700`; unsupported or omitted CRS values are rejected and BNG geometries are transformed to WGS84 during staging.
3. Run `pnpm --filter @surveynt/db import:property-data -- --source ... --version ... --file ... --source-url ... --source-crs ... --neon-storage-usd-per-gb-month ... --dry-run true`.
4. Review record count, invalid rows, file bytes, estimated table bytes and projected storage cost.
5. Import without `--activate` using `--expected-checksum ... --licence-confirmed true`. Review the measured table/index size and sample spatial-query latency printed and stored with the version.
6. Activate the staged version with `pnpm --filter @surveynt/db activate:property-data -- --source ... --version ... --capacity-approved true`. The command rejects versions without a verified checksum, recorded licence confirmation and measured capacity report, then switches the active version atomically. An existing version is never overwritten.
7. Confirm application-role writes fail and property-centred queries return only bounded features.

The importer deletes a failed staged version and retains the previously active version. Dataset sync rows retain the safe failure reason. Roll back with `pnpm --filter @surveynt/db rollback:property-data -- --source ... --version ...`; it accepts only a previously validated, non-empty version and records a `rolled_back` sync.

## Queue operations

Refresh requests return `202` and a run ID. Schedule the protected worker endpoint at a deployment-supported interval. Jobs use exponential backoff up to five attempts. Identity changes are terminal for the old run; request a new refresh after reviewing the property.
