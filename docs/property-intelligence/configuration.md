# Configuration

Placeholders only. Never commit real values. Each variable is server-only unless it is prefixed `NEXT_PUBLIC_`. Variables are listed with the phase that introduces them; `.env.example` mirrors this list.

## Database roles

The migrations create **NOLOGIN group roles**. Operators grant membership to the real login roles once per Neon branch, using the owner connection (`DATABASE_ADMIN_URL`):

```sql
-- Tenant runtime role (the role in DATABASE_APP_URL). It must not have BYPASSRLS.
GRANT surveynt_reference_read TO <app_login_role>;

-- Reference importer role (the role in DATABASE_IMPORTER_URL). Create it with a strong password.
CREATE ROLE <importer_login_role> LOGIN PASSWORD '<generated>' NOBYPASSRLS;
GRANT surveynt_reference_write TO <importer_login_role>;

-- Shared-learning service role (L1+). Leave unassigned while shared learning is disabled.
GRANT surveynt_learning_service TO <learning_login_role>;
```

Grant the tenant runtime role DML on new `public` tables after each migration (or keep `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <app_login_role>` in place). P1 adds `property_identity_events`, `address_lookups`, `provider_rate_limits` and `provider_response_cache`. Existing operator grants on `public` tenant tables are otherwise unchanged. The integration harness (`packages/db/test/harness.ts`) applies the same grants to its throwaway roles.

## PostGIS

The P1 migration runs `CREATE EXTENSION IF NOT EXISTS postgis` as the owner. Before running migrations on a Neon branch, confirm the extension is available there (`select * from pg_available_extensions where name = 'postgis'`). **Do not apply migrations to production without separate authorisation.**

## Environment variables

| Variable | Phase | Purpose | Default when unset |
|---|---|---|---|
| `DATABASE_IMPORTER_URL` | P1 | Login role holding `surveynt_reference_write`; used only by importer CLIs | Importers refuse to run |
| `PROPERTY_INTELLIGENCE_ENABLED` | P1 | Platform kill-switch for address search and intelligence | Off: manual entry only |
| `POSTCODES_IO_BASE_URL` | P1 | Postcodes.io or a self-hosted instance | `https://api.postcodes.io` (still gated by the source registry) |
| `NOMINATIM_BASE_URL` | P1 | Nominatim endpoint (self-hosted recommended) | Unset: Nominatim provider `not_configured` |
| `NOMINATIM_USER_AGENT` | P1 | Identifying User-Agent, for example `Surveynt/1.0 (+https://<domain>/contact)` | Required when Nominatim is configured |
| `NOMINATIM_MIN_INTERVAL_MS` | P1 | Deployment-wide minimum interval between requests | `1100` |
| `EPC_API_BASE_URL` | P2 | EPC data service base URL (confirm on the guidance page) | Unset: EPC `not_configured` |
| `EPC_API_EMAIL` / `EPC_API_KEY` | P2 | EPC credentials if the service uses HTTP Basic | Unset: `not_configured` |
| `EPC_API_TOKEN` | P2 | EPC bearer token if the service issues one | Unset: `not_configured` |
| `PLANNING_DATA_BASE_URL` | P2 | Planning Data API base | `https://www.planning.data.gov.uk` (still gated by the registry) |
| `NEXT_PUBLIC_MAP_STYLE_URL` | P3 | MapLibre style URL from a contracted or self-hosted tile provider | Unset: "Basemap not configured" |
| `NEXT_PUBLIC_MAP_ATTRIBUTION` | P3 | Basemap attribution text required by the provider | Empty |
| `BLOB_READ_WRITE_TOKEN` | A1 | Vercel Blob store token (private store) | Unset: uploads disabled; manual text capture continues |
| `MEDIA_MAX_UPLOAD_MB` | A1 | Per-file upload limit | `25` |
| `ASSISTANT_ENABLED` | A2 | Platform kill-switch for suggestions and discrepancy checks: generation, listing and review (review returns 503 when off). Reinspection reminders from history are not affected | Off |
| `AI_PROVIDER` | A2 | Model adapter key. Only `none` exists until a provider is chosen, registered and evaluated (A6) | `none`: AI features report "unavailable"; deterministic sourced suggestions still work |
| `SHARED_LEARNING_ENABLED` | L0 | Global shared-learning gate | `false`; must stay false until the L0 gates are met |

## Importers

Importers are operator CLIs. They do not run in Vercel functions. Each one:

1. Downloads from the allowlisted official URL, or a provided local file, with a size bound.
2. Validates the checksum, format, CRS and licence metadata.
3. Loads rows under a new `dataset_syncs` id that no query reads until activation.
4. Builds indexes and runs validation queries.
5. Activates atomically (the previous version is retired, not deleted).

Failed runs never touch the active version. See `runbook.md` (P5).

## Enabling a source

Sources stay disabled until an operator has checked the official terms (see `source-register.md`) and records the verification:

```sql
-- Owner connection. Run the registry sync first:
--   DATABASE_ADMIN_URL=… pnpm --filter @surveynt/property-data reference registry-sync
UPDATE reference.data_sources
SET enabled = true, verified_at = now(), verified_by = '<name>', verification_notes = '<licence/terms checked, URL, date>'
WHERE key = 'postcodes_io';
```

A source with `register_status = 'blocked'` is always treated as disabled.

Since P5 the usual route is **Platform → Data sources** (super admin or compliance): "Enable after verification" with a note of what was checked. The same page records release checks, runs probes, activates staged versions and rolls back, and each action is audited. See [`runbook.md`](./runbook.md).

## Importing OS Open UPRN (regional first)

1. Download the CSV release from the OS Data Hub (see the source register) and record its version label.
2. Import a regional extract and benchmark it before any national load:
   ```bash
   DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference os-open-uprn \
     --file ./osopenuprn_202609.csv --version 2026-09 --bbox -2.75,51.38,-2.50,51.52
   ```
3. Activate the staged sync once the validation output is clean (`reference activate --sync <id>`). To return to the previous version, use `reference rollback --source os_open_uprn`.

The importer never truncates the active version. A failed run is marked `failed` and its rows are removed.

## Importing spatial reference layers (P2/P3)

Historic England, INSPIRE, flood zones, surface water, BGS geology and Natural England layers all load through one importer into `reference.spatial_features`. Each `--source/--layer` pair is versioned and activated on its own, so a failed flood-zone import never touches geology.

```bash
# Convert the official download to EPSG:4326 GeoJSONSeq with GDAL (operator machine only), then stage and validate.
DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference spatial-layer \
  --source ea_flood_zones --layer flood_zone_3 --file ./FZ3.gpkg --convert --version 2026-09
# Activate when the output is clean, or pass --activate on the import.
DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference activate --sync <id>
# Return to the previous version of one layer.
DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference rollback --source ea_flood_zones --layer flood_zone_3
```

- Each layer has an attribute allowlist (`layerPresets` in `packages/property-data/src/importers/spatial-layer.ts`). Anything not on it is dropped; INSPIRE keeps only `INSPIREID`, never title numbers or owners.
- The preset field names were written before the official downloads could be inspected (the build environment cannot reach them). Check the real column names first, and override them with `--id-property`, `--name-property` and `--attributes a,b` if they differ.
- Import rejects features outside the UK extent or with invalid geometry. Rows from a failed import are deleted; the active version stays.
- Layers that are not imported, or whose source is not enabled, show as "Not checked" in the Intelligence and Land & Map tabs, never as "no record".

## Importing Price Paid Data and the transaction-to-UPRN look-up (P4)

Sales history needs both datasets, and both sources (`hmlr_price_paid`, `hmlr_ppd_uprn_lookup`) enabled after verification. Sales are linked only through the published look-up: never by address, postcode or distance.

```bash
# 1. Full load (complete or yearly files). --version is the release date: YYYY-MM or YYYY-MM-DD.
#    Optional regional load first: --postcode-areas BS,BA (address columns are read only to filter, never stored).
DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference price-paid \
  --file ./pp-complete.csv --version 2026-09 --mode full --postcode-areas BS,BA
# 2. Each month: apply the change file (A add, C change, D delete) to a copy of the active version.
DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference price-paid \
  --file ./pp-monthly-update.csv --version 2026-10 --mode update --activate
# 3. The look-up (full file each release). The header is detected; pass --transaction-column/--uprn-column if it is not.
DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference price-paid-lookup \
  --file ./uprn-lookup.csv --version 2026-09 --activate
# Undo a bad month:
DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference rollback --source hmlr_price_paid
```

- Stored Price Paid fields: transaction id, price, transfer date, property type, new build, tenure and category. Postcode, PAON, SAON, street, locality, town, district and county are not stored or shown.
- Any malformed row fails the import unless `--max-rejected N` is set. Rejection messages give the line number and reason, never the row's content.
- An update inherits the active version's postcode areas. A property outside them shows "Not checked", not "no sales".
- Each update copies the active version before applying changes. A national load is about 30 million rows, so budget for twice that during an update and prune retired versions afterwards (`prune --source hmlr_price_paid --keep 1`).
- Not verified from this environment (gov.uk is blocked): the look-up's exact header names, and whether it is published as full files or change files. The importer assumes full files.

## Country-specific sources (P6)

Wales, Scotland and Northern Ireland use their own publishers only. See [`country-coverage.md`](./country-coverage.md), which is generated and checked by a test.

- **Spatial layers** load through the same `spatial-layer` command. The source keys and layers are:
  - `nrw_flood_map_planning`: `flood_zone_2`, `flood_zone_3`;
  - `cadw_listed_buildings`: `listed_building`;
  - `hes_designations`: `listed_building`, `scheduled_monument`, `conservation_area`, `garden_designed_landscape`, `battlefield`, `world_heritage_site`;
  - `sepa_flood_maps`: `river_*`, `coastal_*` and `surface_water_*`, each `high`, `medium` or `low`;
  - `ni_hed_listed_buildings`: `listed_building`.

  The attribute presets are provisional. Check each download's column names and override them with `--id-property` and `--attributes`.
- **Scottish EPC Register extract**, imported in full each quarter. It is matched by the published UPRN reference only. Rows without one are counted and not stored. No address field is stored.
  ```bash
  DATABASE_IMPORTER_URL=… pnpm --filter @surveynt/property-data reference scottish-epc --file ./domestic.csv --version 2026-Q3 --activate
  # If the header names differ from the reported ones (osg_reference_number, report_reference_number, …):
  … reference scottish-epc --file ./domestic.csv --version 2026-Q3 --column uprn=OSG_UPRN --column certificateKey=REPORT_REFERENCE_NUMBER
  ```
- **Northern Ireland** address resolution and energy certificates stay unsupported (`ni_pointer` and `ni_epc` are blocked in the register). Northern Ireland properties show "not covered" for every Great Britain source.

## Basemap

The map draws imported layers on a plain background until `NEXT_PUBLIC_MAP_STYLE_URL` points at a MapLibre style from a contracted or self-hosted tile provider. Public OpenStreetMap tiles are not used: their usage policy rules out this kind of production traffic. Set `NEXT_PUBLIC_MAP_ATTRIBUTION` to the provider's required attribution. Layer attribution comes from the source register automatically.

MapLibre's worker is copied from `node_modules` into `apps/web/public/vendor/maplibre-gl/<version>/` by `apps/web/scripts/copy-maplibre-worker.mjs` during `dev` and `build`. The copy is gitignored and listed in the turbo build outputs.

## Known schema-tool caveat

drizzle-kit 0.31 emits `geometry(point)` without an SRID and orders some constraints incorrectly. The P1 migration SQL was corrected by hand (`geometry(point, 4326)`, and the unique key placed before the composite FK). The integration suite applies every migration from scratch and would fail on regressions.
