# Reference data runbook (P5)

Operators manage sources in two places:
- **Platform → Data sources** (`/platform/data-sources`): enable a source after verification, record release checks, run probes, activate staged versions and roll back. Super admin or compliance access is required, and every action is written to the platform audit trail.
- **The importer CLI** (`pnpm --filter @surveynt/property-data reference …`), run on an operator machine with `DATABASE_IMPORTER_URL`. All heavy imports happen here, never in a Vercel function.

## Lifecycle of a dataset version

1. **Check the release.** Open the source's official page (linked from the Data sources page). If there is no newer release, record a release check with a note. That resets the freshness clock.
2. **Import a regional extract first**, then national. Each import creates a staged `dataset_syncs` row that no query reads. See [`configuration.md`](./configuration.md) for each importer's flags.
3. **Validate.** The importer refuses malformed rows (rejection thresholds), out-of-extent geometry and CRS mismatches. A failed run is marked `failed` and its rows are removed.
4. **Activate**, from the Data sources page or with `reference activate --sync <id>`. Activation is atomic per source and layer, under an advisory lock. The previous version is kept as `retired`, and cached public responses for the source are cleared.
5. **Watch.** Intelligence results built from an older version are flagged "a newer version of this dataset is active", and users can refresh them. Snapshots are never rewritten.
6. **Prune** old versions once the new one has been used for a while: `reference prune --source <key> [--layer <layer>] --keep 1`.

## Rollback and recovery

| Situation | Action |
|---|---|
| A new version is wrong (bad extent, wrong columns) | "Roll back" on the active version, or `reference rollback --source <key> --layer <layer>`. The previous retired version becomes active again and caches are cleared |
| An import failed half-way | Nothing to do. Failed runs never touch the active version, and their rows are deleted. Fix the input and re-run |
| A source's licence or terms change | Disable the source on the Data sources page. Providers stop at once and results show "Not checked". Update the source register before enabling again |
| A live API is failing | The daily sweep and "Probe now" record failures. Runs keep partial results, and the failing source shows "unavailable". Check the provider's status page; nothing needs rolling back |
| The database must be restored | Restore the Neon branch to a point in time. Reference data is reproducible from the recorded source URLs, versions and checksums in `dataset_syncs` |

## Daily sweep (`/api/cron/daily`)

- Probes enabled live APIs: postcodes.io and Planning Data. Nominatim is never probed because of its usage policy. EPC is not probed until a documented status endpoint is confirmed.
- Lists enabled imported sources that are due a release check (no import or recorded check within the source's policy window).
- Backfills photo and document analyses (A4), and processes queued intelligence runs (P2).

## Synthetic benchmark (local)

`TEST_DATABASE_URL=… pnpm --filter @surveynt/property-data benchmark` generates synthetic data and times the real importers and queries.

Environment: PostgreSQL 16 with PostGIS 3.4 in the build container, reached through the Neon WebSocket driver and a local relay. Run on 2026-10-02:

| Step | Volume | Time | Throughput |
|---|---|---|---|
| OS Open UPRN import | 200,000 points | 4.8 s | ~41,700 rows/s |
| Spatial layer import | 20,000 small polygons | 0.9 s | ~22,500 rows/s |
| Price Paid full import | 200,000 sales | 4.6 s | ~43,100 rows/s |
| Price Paid monthly update (copy, then apply 20,000 changes) | 200,000 base rows | 2.4 s | — |
| Transaction ↔ UPRN look-up import | 200,000 links | 3.9 s | ~50,700 rows/s |
| UPRN candidate search (75 m) | 200 queries | p50 10.1 ms, p95 14.7 ms | — |
| Point-in-layer query | 200 queries | p50 4.7 ms, p95 5.8 ms | — |
| Sales for a UPRN | 200 queries | p50 4.5 ms, p95 5.4 ms | — |

Measured storage: about 215 bytes per UPRN point, 165 bytes per sale and 235 bytes per look-up link, including indexes.

## Scale-up estimates (not measured at national scale)

These are linear extrapolations from the benchmark. They are planning figures, not guarantees. Confirm record counts in each release's notes, and run a regional import on the target Neon branch first.

| Dataset | Approximate national size | Import time at benchmark rate | Storage per version |
|---|---|---|---|
| OS Open UPRN | ~40 million points (confirm per release) | ~16–20 min | ~9 GB |
| Price Paid (complete file) | ~30 million sales | ~12 min | ~5 GB; a monthly update copies the active version, so allow 2× during the update |
| Transaction ↔ UPRN look-up | similar to Price Paid | ~10 min | ~7 GB |
| INSPIRE Index Polygons | ~24 million polygons, with real geometry far larger than the benchmark squares | Hours | Tens of GB: import by local authority, only where firms work |
| Flood zones and designations | Fewer, but complex, polygons | Minutes | Depends on vertices: measure regionally |

Recommendations:
- Start with the regions where pilot firms work. Use `--bbox` (UPRN), `--postcode-areas` (Price Paid) and per-authority downloads (INSPIRE).
- Keep at most one retired version of the large datasets after a successful month (`prune --keep 1`).
- Run national imports against a Neon branch, check them, then promote the branch. Importer throughput over the Neon network will differ from the local benchmark.

## Ongoing cost categories

Prices are not quoted here because they could not be verified from this environment. Check each provider's current pricing before go-live.

| Category | Driver | Notes |
|---|---|---|
| Database storage (Neon) | Reference datasets and retained versions, plus tenant data | Largest item once national datasets are loaded |
| Database compute (Neon) | Imports (bursty), spatial queries, enrichment runs | Imports run off-peak from the CLI |
| Object storage (Vercel Blob) | Survey photos and documents (originals kept) | Grows with surveys; plus egress for viewing |
| Functions (Vercel) | API routes, `after()` work, the queue consumer and the daily cron | Photo and PDF analysis adds CPU per upload |
| Basemap tiles | Contracted or self-hosted tile provider | Required before maps show a basemap |
| Geocoding | Self-hosted or contracted Nominatim; postcodes.io (free, or self-hosted) | Public Nominatim is for low volume only |
| Data licences | OS OpenData, HMLR, EA, Natural England and Historic England open data are OGL (no fee, attribution required); EPC requires registration | Blocked sources (BGS 1:50k, mining) need commercial terms |
| AI provider | None configured | Governed by A6 before any spend |
