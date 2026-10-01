# Property intelligence operations

## Required configuration

- `DATABASE_APP_URL` and `DATABASE_ADMIN_URL`
- `QUEUE_CONSUMER_SECRET` or `CRON_SECRET`
- `NOMINATIM_BASE_URL` and a contactable `NOMINATIM_USER_AGENT` to enable submitted geocoding. The public OSM endpoint additionally requires the existing Upstash REST configuration so its deployment-wide request limit can be enforced; a hosted or self-managed compatible provider may use its own service policy.
- `EPC_API_EMAIL`, `EPC_API_KEY` and optional `EPC_API_BASE_URL` after licence acceptance
- `NEXT_PUBLIC_MAP_STYLE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` before production map launch

## Import procedure

Run the read-only database gate first with `pnpm --filter @surveynt/db check:property-data-capabilities`. It reports PostGIS availability, role separation and whether the property-intelligence tables already exist without installing extensions or changing schema.

The 1 October 2026 audit of the configured Neon project found PostgreSQL 18.6, PostGIS 3.6.4 available but not installed, separate application and administrator roles, and no property-intelligence tables applied. Spatial-function privileges therefore remain an explicit post-migration check.

1. Obtain the official release and record its licence, publication date and source URL.
2. Convert spatial products to UTF-8 CSV in EPSG:4326. OS Open UPRN headers must include `uprn,latitude,longitude`; other layers require `source_record_id,wkt` with optional `name,properties_json`.
3. Run `pnpm --filter @surveynt/db import:property-data -- --source ... --version ... --file ... --source-url ... --dry-run true`.
4. Review record count, invalid rows, file bytes and estimated table bytes.
5. Import without `--activate`, validate staging queries and index/storage cost, then repeat with a new verified version and `--activate true`. An existing version is never overwritten.
6. Confirm application-role writes fail and property-centred queries return only bounded features.

The importer deletes a failed staged version and retains the previously active version. Dataset sync rows retain the safe failure reason. Roll back with `pnpm --filter @surveynt/db rollback:property-data -- --source ... --version ...`; it accepts only a previously validated, non-empty version and records a `rolled_back` sync.

## Queue operations

Refresh requests return `202` and a run ID. Schedule the protected worker endpoint at a deployment-supported interval. Jobs use exponential backoff up to five attempts. Identity changes are terminal for the old run; request a new refresh after reviewing the property.
