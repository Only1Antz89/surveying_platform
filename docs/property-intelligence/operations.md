# Property intelligence operations

## Canonical schema reconciliation

After applying migrations, initialise the canonical source register with `pnpm --filter @surveynt/property-data reference:registry-sync`. Enabling and verifying sources remains an explicit platform-operator action.

Before a production migration or bridge, capture the rollback metadata with `pnpm --filter @surveynt/db backup:reference-metadata -- --output /private/tmp/surveynt-reference-metadata-YYYY-MM-DD.json`. The command refuses to overwrite an existing backup and records active legacy/canonical versions, registry decisions and the migration journal.

After creating or rotating the application login, run `pnpm --filter @surveynt/db grant:reference-read`. It resolves the login from `DATABASE_APP_URL`, grants only the `surveynt_reference_read` group role through the administrator connection, and audits the grant. Never grant `surveynt_reference_write` to the web runtime.

After source-specific checks pass, explicitly enable one source with `pnpm --filter @surveynt/property-data reference:source-enable -- --source historic_england_nhle --notes "OGL terms, layer counts and sample queries verified 2026-10-02"`. Disable it immediately with the matching `reference:source-disable` command if a licence, coverage or health check fails. Both actions are audited; registry reconciliation never changes an operator's existing enablement decision.

For installations containing the first England release in `public.dataset_versions` and `public.spatial_reference_features`, run `pnpm --filter @surveynt/property-data reference:bridge-legacy-historic-england`. The command is idempotent: it validates every layer, preserves provenance, and activates all bridged Historic England layers in one transaction. A failed validation leaves the currently active reference versions untouched.

The current 1 GB production project cannot hold a second 434 MB physical copy. Production therefore uses the explicit `--legacy-reference` bridge mode: canonical source/version metadata and provider orchestration live in `reference.*`, while the already validated immutable Historic England geometry is read in place from the legacy table through a bounded compatibility adapter. All eight layers, 401,771 records, application-role queries and write denial were verified after activation. This is a storage compatibility mode, not a second canonical implementation; remove it by running the normal copying bridge after increasing capacity, then retire the adapter.

Set `PROPERTY_INTELLIGENCE_ENABLED=true` only after the registry, reference-role grants, Nominatim identification, map attribution and worker secrets have been verified.

Remaining external work:

- Full HMLR national conversion needs approximately 50 GB of scratch storage.
- EPC remains disabled until credentials, licence acceptance and data-protection handling are complete.

## Required configuration

- `DATABASE_APP_URL` and `DATABASE_ADMIN_URL`
- `QUEUE_CONSUMER_SECRET` or `CRON_SECRET`
- `NOMINATIM_BASE_URL` and a contactable `NOMINATIM_USER_AGENT` to enable submitted geocoding. Redis is used when configured; otherwise the production database provides the tenant cache and atomic deployment-wide provider rate gate.
- `ADDRESS_SEARCH_CACHE_TTL_SECONDS` optionally controls the tenant-scoped submitted-search cache (default one day; clamped between one minute and seven days).
- `EPC_API_EMAIL`, `EPC_API_KEY` and optional `EPC_API_BASE_URL` after licence acceptance
- `NEXT_PUBLIC_MAP_STYLE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` before production map launch

## Import procedure

Run the read-only database gate first with `pnpm --filter @surveynt/db check:property-data-capabilities`. It reports PostGIS availability, role separation and whether the property-intelligence tables already exist without installing extensions or changing schema.

The production migration was applied on 2 October 2026 with PostGIS 3.6.4 on PostgreSQL 18.6. After the concurrent Claude merge was reconciled, the additive migration journal through 0025 was applied as well; production then reported all 26 migrations present and 802,430,976 database bytes. The post-migration audit confirmed separate application and administrator roles, application-role spatial-function access, readable source metadata, denied reference-table writes, tenant isolation against a guessed organisation ID, all required RLS policies (including the geocoder cache/rate tables), and the immutable-snapshot trigger. Run `pnpm --filter @surveynt/db verify:property-data-security` after future permission or migration changes.

Run `pnpm --filter @surveynt/db verify:property-data-spatial` after PostGIS or spatial-index changes. It uses temporary versioned fixtures to check metre-based nearby-UPRN ambiguity, inside/outside/boundary intersections and EPSG:27700 to EPSG:4326 transformation, then verifies complete fixture removal.

1. Obtain the official release and record its licence, publication date and source URL.
2. Convert source data to UTF-8 CSV. OS Open UPRN headers must include `uprn,latitude,longitude`; other layers require `source_record_id,wkt` with optional `name,properties_json`. Declare either `--source-crs EPSG:4326` or `--source-crs EPSG:27700`; unsupported or omitted CRS values are rejected and BNG geometries are transformed to WGS84 during staging.
3. Run `pnpm --filter @surveynt/db import:property-data -- --source ... --version ... --file ... --source-url ... --source-crs ... --neon-storage-usd-per-gb-month ... --dry-run true`.

For an official GeoJSON release, first create the canonical spatial CSV without changing the database:

`pnpm --filter @surveynt/db prepare:spatial-geojson -- --output /private/tmp/source.csv --source-crs EPSG:4326 --input listed_building=/path/listed.geojson --input scheduled_monument=/path/scheduled.geojson`

Each repeated input must have a stable, unique label. The preparer prefixes source identifiers with that label, converts supported GeoJSON geometry to WKT, preserves source properties, and records the designation type. It refuses non-WGS84 declarations, missing geometry, missing identifiers, duplicate labels, and existing output files.

The preparer streams the features array, so national files are not loaded into memory. Use `--where Flood_zone=2` and a separate `--where Flood_zone=3` run for the Environment Agency product; never combine the two output files or infer Flood Zone 1 from their absence.

When an official OGC API Features collection is available, download and prepare it directly without retaining a multi-gigabyte GeoJSON document:

`pnpm --filter @surveynt/db prepare:ogc-features -- --endpoint https://environment.data.gov.uk/geoservices/datasets/04532375-a198-476e-985e-0579a0a11b47/ogc/features/v1/collections/Flood_Zones_2_3_Rivers_and_Sea/items --output /private/tmp/ea-flood-zone-2.csv --source-crs EPSG:4326 --source-prefix flood_zone_2 --filter-field flood_zone --filter-value FZ2 --page-size 1000 --rewrite-pagination-origin https://api-k8s-dsp-prod.agrimetrics.co.uk`

Run the same command with a distinct output, `flood_zone_3` and `FZ3` for Zone 3. The command uses a CQL2 filter, follows bounded pagination only on the same collection path and public HTTPS origin, confirms the service's total count and validates every returned feature against the requested layer. The EA service currently emits one unresolvable Agrimetrics backend link during later Zone 2 pages. The explicit rewrite option accepts only that exact origin and identical path, then requests the unchanged path and query through the reviewed public EA origin. It retries transient service failures three times and deletes only its newly created partial output on failure. The GeoJSON API response is CRS84/WGS84 even though the publisher also exposes the source dataset in British National Grid.

For HMLR INSPIRE GML, extract each downloaded authority archive and prepare the national file with:

`pnpm --filter @surveynt/db prepare:spatial-gml -- --output /private/tmp/hmlr.csv --source-crs EPSG:27700 --input adur=/path/Land_Registry_Cadastral_Parcels.gml --input amber_valley=/path/Land_Registry_Cadastral_Parcels.gml`

The GML preparer streams each authority file, requires British National Grid polygons, retains INSPIRE provenance, marks boundaries as indicative and non-definitive, and deduplicates INSPIRE identifiers repeated across local-authority boundaries.

Before downloading nationally, capture the 318 current download links from the official HMLR catalogue as a JSON array of `{ "href": "...", "rowText": "Authority name\\tDownload .gml" }` objects. Build the reviewed England-only manifest with:

`pnpm --filter @surveynt/db prepare:hmlr-manifest -- --output /private/tmp/hmlr-england.json --release 2026-09 --published-at 2026-09-06 < /private/tmp/hmlr-catalogue.json`

The command deliberately fails if the catalogue is not exactly 318 unique official-host archives, any of the 22 Welsh principal-area files is absent, or the England result is not exactly 296 authorities. This is a catalogue-drift gate, not a permanent assertion about future local-government structure; update and review the exclusions when HMLR changes the catalogue. Direct automated access to the catalogue currently enters a redirect loop, so capture must come from a successfully rendered official page rather than bypassing the service's browser controls.

The reviewed September 2026 result is stored in `docs/property-intelligence/hmlr-england-authorities-2026-09.json` (SHA-256 `37b9daf558e2364692bfb9d4e36972deeac97d329f8d7b15ec8bf4ac8d95b3c0`). Use its stable labels as the `--input` labels for the GML preparer. Do not retain or import the 22 excluded Welsh archives in the England release.
4. Review record count, bounded row diagnostics, duplicate or missing headers, invalid UPRNs/coordinates/geometries, file bytes, estimated table bytes and projected storage cost. Empty or semantically invalid files do not reach staging.
5. Import without `--activate` using `--expected-checksum ... --licence-confirmed true --neon-storage-usd-per-gb-month ...`. All three gates are mandatory for a staged import. Review the measured table/index size and sample spatial-query latency printed and stored with the version.
6. Activate the staged version with `pnpm --filter @surveynt/db activate:property-data -- --source ... --version ... --capacity-approved true`. The command rejects versions without a verified checksum, recorded licence confirmation and measured capacity report, then switches the active version atomically. An existing version is never overwritten.
7. Confirm application-role writes fail and property-centred queries return only bounded features.

The importer deletes a failed staged version and retains the previously active version. Dataset sync rows retain the safe failure reason. Roll back with `pnpm --filter @surveynt/db rollback:property-data -- --source ... --version ...`; it accepts only a previously validated, non-empty, capacity-approved version and records a `rolled_back` sync.

## Production state on 2 October 2026

- Historic England `2026-10-01` is active with 401,771 records and canonical checksum `1ff55a620d79b0e827a36ff8f6fc19eb19d77f37ee9635bb0506fa215822fe92`.
- Its staged measurement recorded 434,077,696 total relation bytes, 77,242,368 index bytes, a 12.36 ms sampled intersection query, and USD 0.1415/month projected storage at USD 0.35/GiB-month.
- EA Flood Zone 2 staging was safely aborted when Neon reported its 1,024 MB project limit. The inactive partial version was deleted and the previous active state was preserved. EA Flood Zones 2/3 and OS Open UPRN remain inactive with zero live records.
- The shared spatial relation currently occupies 781,008,896 bytes including 172,392,448 index bytes because failed large staging attempts left dead allocation. Reclaiming it with `VACUUM FULL` takes an exclusive table lock and requires an explicitly approved maintenance window.
- Full HMLR national conversion still needs roughly 50 GB of scratch storage. EPC still needs credentials and licence acceptance.

Do not retry the national EA or OS imports on the current 1,024 MB project. First increase the database storage allowance, review the revised cost, and decide whether to schedule the exclusive-lock compaction. A failed import must never be activated.

## Queue operations

Refresh requests return `202` and a run ID. Schedule the protected worker endpoint at a deployment-supported interval. Jobs use exponential backoff up to five attempts. Identity changes are terminal for the old run; request a new refresh after reviewing the property.

The Vercel Hobby deployment runs `/api/cron/property-intelligence` daily at 08:05 UTC. The endpoint remains protected by `CRON_SECRET`/`QUEUE_CONSUMER_SECRET`, so a separately operated scheduler can call it more frequently if the queue service-level objective later requires that.

Run `pnpm --filter @surveynt/web verify:property-worker` with the repository environment loaded to verify that the deployed route rejects an invalid token and can process the current queue using the configured worker secret.

## Provider smoke checks

Run `pnpm --filter @surveynt/property-data verify:providers` to validate the public Postcodes.io and Planning Data adapters against the labelled Bristol development fixture. It does not persist results and treats Planning Data `no_match` only as an empty response from the queried datasets. Production submitted search uses `https://nominatim.openstreetmap.org` with an identifying Surveynt user agent, explicit-submit behaviour, a one-day cache and a global one-request-per-second database gate. The production map uses the OpenFreeMap Liberty style with OpenFreeMap, OpenMapTiles and OpenStreetMap attribution. Public services remain development/low-volume fallbacks without an application SLA. EPC requires separate live verification after credentials and licence acceptance.
