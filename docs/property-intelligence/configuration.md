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

Existing operator grants on `public` (tenant tables) are unchanged. The integration harness (`packages/db/test/harness.ts`) applies the same grants to its throwaway roles.

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
| `ASSISTANT_ENABLED` | A2 | Platform kill-switch for proposals and tasks | Off |
| `AI_PROVIDER` | A2 | Model adapter key | `none`: AI features report "unavailable" |
| `SHARED_LEARNING_ENABLED` | L0 | Global shared-learning gate | `false`; must stay false until the L0 gates are met |

## Importers

Importers are operator CLIs. They do not run in Vercel functions. Each one:

1. Downloads from the allowlisted official URL, or a provided local file, with a size bound.
2. Validates the checksum, format, CRS and licence metadata.
3. Loads into a new `dataset_version_id` partition.
4. Builds indexes and runs validation queries.
5. Activates atomically, then records a `dataset_syncs` row.

Failed runs never touch the active version. See `runbook.md` (P5).
