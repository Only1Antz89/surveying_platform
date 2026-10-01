# Property intelligence architecture

Checked: 1 October 2026

## Runtime flow

Authenticated browser requests go through the existing tenant API context. Address search calls bounded server-side adapters. A confirmed property identity is stored on the tenant property with evidence in the audit log. Refresh requests create an `enrichment_runs` record and a deduplicated `background_jobs` entry. The protected worker runs providers independently and writes immutable source snapshots only if the property identity is unchanged.

National reference datasets are global and read-only to the application role. Imports use `DATABASE_ADMIN_URL`, stage a new dataset version, validate record counts and checksums, and activate it transactionally. The last active version remains available when an import fails.

## Trust model

- Surveyor confirmation is separate from external records.
- A postcode centroid is approximate and never establishes a building or UPRN.
- OS Open UPRN supplies identifiers and coordinates, not a reusable postal address directory.
- `no_match` means no record was returned from the queried dataset. It does not mean a constraint or risk is absent.
- HMLR extents, mapped heritage and flood layers are contextual. They do not replace title, planning, heritage or environmental searches.

## Database and jobs

- PostgreSQL/Neon with PostGIS, Drizzle migrations and tenant RLS.
- `geometry(Point,4326)` property and UPRN locations; reference feature geometry is constrained to SRID 4326.
- Durable database queue with bounded retries and idempotency. The worker is called through `/api/cron/property-intelligence` using `QUEUE_CONSUMER_SECRET` or `CRON_SECRET`.
- Provider credentials are server-only. Provider hosts come from code or deployment configuration; request input cannot supply an arbitrary fetch URL.

## Deployment gates

Before applying the migration or importing national data, verify `PostGIS_Full_Version()` using the admin role, confirm the application role can read but not write reference tables, and run a dry-run capacity report. Do not activate a national version until storage, index size, query latency and projected Neon cost are accepted.
