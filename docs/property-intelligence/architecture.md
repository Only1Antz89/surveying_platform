# Property intelligence and assistant architecture

Status: P0 baseline, 2026-10-01. Later phases update this file; [`progress.md`](./progress.md) is the authoritative checklist.

## Repository facts confirmed during P0

The brief's assumptions were checked against the repository. Corrections are marked **(correction)**.

| Area | Confirmed state | Evidence |
|---|---|---|
| Workspace | pnpm 11.19 workspaces with Turborepo 2.11 (`apps/*`, `packages/*`) | `package.json`, `pnpm-workspace.yaml`, `turbo.json` |
| Web framework | Next.js 16.3.7 App Router. Clerk runs from `src/proxy.ts`, which replaces `middleware.ts` in Next 16. React 19.2, zod 4 | `apps/web/package.json`, `apps/web/src/proxy.ts` |
| Database | Neon PostgreSQL through `@neondatabase/serverless` `Pool` and Drizzle ORM 0.44. Interactive transactions are required because RLS context is transaction-local | `packages/db/src/index.ts` |
| Migrations | drizzle-kit 0.31, output to `packages/db/migrations/generated`. Hand-written SQL (RLS, triggers) is journaled alongside generated SQL | `packages/db/drizzle.config.ts`, `migrations/generated/meta/_journal.json` |
| Tenancy | Every tenant table has `organisation_id` and a `FORCE ROW LEVEL SECURITY` policy on `current_setting('app.current_organisation_id')`. The runtime role has no `BYPASSRLS` | `migrations/generated/0001_tenant_rls.sql`, `0003_tenant_rls_expansion.sql` |
| Roles | Three connections: `DATABASE_APP_URL` (tenant runtime, RLS enforced), `DATABASE_ADMIN_URL` (owner: migrations, webhooks, platform), and `DATABASE_URL` (Neon integration). No role or grant SQL is in migrations; grants are operator-managed | `.env.example`, `README.md` |
| Auth | Clerk organisations map to `organisations.clerk_organisation_id`. `apiContext()` and `requireFirmAccess()` resolve membership, role and billing access level. `platformApiContext()` resolves platform staff. A demo mode runs when Clerk is not configured | `apps/web/src/lib/access.ts` |
| Permissions | `canMutateOperations`, `canManageTeam` etc. in `@surveynt/domain`. Platform roles: `super_admin`, `support`, `billing`, `compliance` | `packages/domain/src/index.ts` |
| API conventions | `/api/v1/*` route handlers. `ok()`/`problem()` envelopes, zod `parseBody`, optimistic concurrency via `version`, and an `audit_events` insert per mutation | `apps/web/src/lib/api.ts`, `apps/web/src/app/api/v1/properties/[id]/route.ts` |
| Audit | `audit_events` is append-only (trigger `prevent_audit_mutation`). Tenants may read and insert their own rows | `0001_tenant_rls.sql` |
| Background work | **(correction: no external queue)** The durable outbox is the `background_jobs` table: deduplication key, attempts, `available_at`, and a claim via conditional `UPDATE … WHERE status='queued'`. It is processed by the daily Vercel cron (`/api/cron/daily`, `CRON_SECRET`) and by bearer-protected `/api/queues/*` consumers (`QUEUE_CONSUMER_SECRET`) | `apps/web/src/lib/email-queue.ts`, `vercel.json` |
| Versioned definitions | `practice_packs` and `practice_pack_versions` (jsonb `definition`, draft/published) administered by platform compliance staff | `apps/web/src/app/api/platform/practice-packs/*` |
| CRM vocabulary | **(correction)** The brief's "customer/instructing party" is the existing **client** (`clients`, `client_contacts`). "Survey/job" is the existing **job** (`jobs`, `job_stage_events`), with free-text `jobs.service_name` as the service level | `packages/db/src/schema.ts` |
| Property model | Address only (`line_1`, `line_2`, `city`, `postcode`, `property_type`), owned by a client. No coordinates, UPRN or country | `packages/db/src/schema.ts` |
| Not present | **(correction)** PostGIS, file storage, survey forms, observations, photos, documents, AI providers, maps, CI workflows, database integration tests | repository search |
| Hosting | Vercel (`lhr1`), one daily cron. The plan tier is not visible in the repository, so the design must not depend on frequent cron | `vercel.json` |

## Target data flow

```
Browser (firm portal, offline outbox)
  │  Clerk session
  ▼
/api/v1/* route handlers ── apiContext(): membership, role, billing access
  │                         withTenant(): set_config('app.current_organisation_id')
  ├─► address search/resolve ─► @surveynt/property-data adapters (allowlisted fetch)
  │                              └─► reference tables (OS Open UPRN, spatial layers)  [read-only]
  ├─► intelligence refresh ──► enrichment_runs + background_jobs(queue=property_intelligence)
  │                              └─► worker: orchestrator → adapters/reference queries
  │                                         → immutable property_intelligence_snapshots
  ├─► surveys / observations / media / proposals / tasks (tenant tables, RLS)
  │       └─► @surveynt/assistant: form schema, rules, proposals, composer
  │             └─► AssistantModel (no provider configured → "unavailable")
  └─► reports: approved observations + approved wording → frozen report_versions

Platform admin (/platform/*) ── platformApiContext() ── data sources, imports, reviews
Operator CLI importers ── DATABASE_IMPORTER_URL ── dataset_versions staging → atomic activation
Shared learning (disabled) ── learning_restricted.* ── reviewed releases → shared_cases
```

## Packages

| Package | Responsibility | Runtime |
|---|---|---|
| `@surveynt/property-data` | Provider contract, adapters, matching rules, normalisers, provenance/licence snapshots, country coverage registry, orchestrator, allowlisted HTTP, importer CLIs | Server only (never imported by client components) |
| `@surveynt/assistant` | Form schema and element taxonomy, field classes, proposal contract and review state machine, adaptive rules, task derivation, evidence model, wording/report composer, `AssistantModel` interface, evaluation harness | Pure TypeScript (safe on server and client) |
| `@surveynt/learning` | Contribution scopes, eligibility gate, deterministic sanitiser, case schema, release manifest checks, withdrawal propagation | Server only |
| `@surveynt/db` | Drizzle schema, migrations, `withTenant` helper, integration-test harness (`test/`) | Server only |

Database persistence, route handlers and UI stay in `apps/web/src/lib/**`, `apps/web/src/app/**` and `apps/web/src/components/**`, as the existing code does.

## Database strategy

- **Additive only.** New nullable columns, new tables and new enum values. No column drops, renames or type narrowing. Each phase adds drizzle-kit generated SQL plus journaled custom SQL for extensions, roles, grants, RLS and triggers.
- **Schemas**
  - `public`: tenant tables (RLS on `organisation_id`) and existing global tables.
  - Reference data (also `public`, from migration 0006): `data_sources`, `dataset_versions`, `dataset_syncs`, `os_uprn_points`, `spatial_reference_features`, `price_paid_*` and `scottish_epc_certificates`. Every role reads them through a SELECT policy; only `surveynt_reference_write` (importers, by write policy) and the owner can write.
  - `learning_restricted`: shared-learning staging. It has no grant to the tenant runtime role; only `surveynt_learning_service` and the owner can access it.
- **Group roles** are created idempotently in migrations as `NOLOGIN` roles. Operators grant membership to real login roles (see [`configuration.md`](./configuration.md)). This keeps role names stable across Neon branches without embedding credentials.
- **RLS:** every new tenant table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and the existing `organisation_id = current_setting(...)` policy. Cross-table consistency (for example, a property and its job in the same firm) is enforced with composite foreign keys on `(organisation_id, id)` where a child references a tenant parent.
- **Immutability:** snapshots, identity events, frozen report versions and dataset release manifests reject `UPDATE`/`DELETE` with triggers modelled on `prevent_audit_mutation`.
- **PostGIS:** `CREATE EXTENSION IF NOT EXISTS postgis` runs in a migration under the owner role.
  - Neon supports PostGIS, but it must be confirmed on each target branch before migrating.
  - Point data is stored as `geometry(Point, 4326)` with GiST indexes.
  - Imports keep the source CRS (EPSG:27700 for OS/HMLR/EA/BGS) in dataset metadata and transform with `ST_Transform`.
  - Metre distances use `geography` casts (`ST_DWithin(geom::geography, …, metres)`).
- **Property identity** is nullable and per-tenant. UPRN is text with format validation and is **not unique**, because two firms may hold the same building.

## Background-job strategy

The existing `background_jobs` outbox is reused with new queues: `property_intelligence`, `assistant`, `media`, `learning`.

1. **Enqueue:** the route handler inserts a job with a deduplication key (the idempotency key) inside the same tenant transaction as the run record, then returns the run ID.
2. **Accelerate:** `after()` from `next/server` attempts to process that one job once the response is sent. This is best-effort only; durability comes from the table.
3. **Consume:** `/api/queues/<queue>` (bearer `QUEUE_CONSUMER_SECRET`) and the daily cron sweep claim due jobs. A lease column, `locked_until`, lets a crashed `processing` job be reclaimed after expiry.
4. **Freshness guard:** each job stores an input fingerprint (property version, UPRN, coordinates, country). If the property changed after enqueue, the worker records its output against the old fingerprint as `superseded` and never makes it current.
5. **Bounded:** each provider has its own timeout, transient-only retries with backoff, a per-run provider concurrency limit, and a maximum attempt count. Failures are stored as safe codes and short messages; payloads and secrets are never stored.

If the Vercel plan allows only daily cron, interactive refreshes still complete through `after()` and the client-polled run status endpoint. Scheduled freshness checks run daily.

## Feature flags

| Level | Mechanism | Default |
|---|---|---|
| Platform | `PROPERTY_INTELLIGENCE_ENABLED`, `ASSISTANT_ENABLED`, `SHARED_LEARNING_ENABLED` env vars | intelligence/assistant off until configured; shared learning **always off** until the L0 gates are met |
| Firm | `entitlements` keys (`property_intelligence`, `assistant`, `assistant_ai`, `shared_learning_contribution`) | off |
| Source | `data_sources.enabled` | off until the source register status is `verified` and any credentials are configured |

Manual property entry, survey capture and report preparation never depend on any flag.

## Security controls

- Every route resolves `apiContext()` and sets the tenant context. Records are read and written only through RLS-scoped transactions, and IDs are always filtered by `organisation_id` as well.
- Outbound requests go through an allowlisted fetch wrapper (fixed hosts per adapter, HTTPS only, no redirects to other hosts, response size cap). Users never supply URLs.
- Inputs are validated: coordinates within UK bounds, query length limits, UPRN `^[0-9]{1,12}$`, and the country enum.
- Provider credentials are server-only environment variables. They are never sent to the client or written to logs.
- A global cache holds only responses from public sources, keyed by source, dataset version, country, normalised inputs and location fingerprint. Tenant addresses and findings are never cached globally.
- Identity confirmations, refreshes, imports, activations, reviews, overrides and AI consent changes are audited in `audit_events`.

## Testing strategy

- Package unit tests use vitest (`pnpm test` through turbo).
- Integration tests live in `packages/db/test/*.integration.test.ts` (plus web equivalents) and run with `pnpm test:integration` and `TEST_DATABASE_URL`.
  - The harness creates a fresh database, applies every journaled migration, and provisions an app role without `BYPASSRLS` and an importer role.
  - It reaches local PostgreSQL 16 + PostGIS 3.4 through the production Neon driver via a local WebSocket relay.
  - Turbo's strict env mode filters `TEST_DATABASE_URL`, so these tests are skipped inside `pnpm check` and run explicitly.
- Browser smoke tests use Playwright against demo mode, with Chromium from `/opt/pw-browsers`.

## Known environment constraint (P0)

The build environment's egress policy blocked every official provider host (`api.postcodes.io`, `nominatim.openstreetmap.org`, `www.planning.data.gov.uk`, `www.gov.uk`, `environment.data.gov.uk`, `get-energy-performance-data.communities.gov.uk`, `api.os.uk`, `use-land-property-data.service.gov.uk`, `historicengland.org.uk`, `www.bgs.ac.uk`, `ico.org.uk`, `www.rics.org`). As a result:

- Source facts were corroborated through web search summaries only. Every source is therefore recorded as **pending**, not verified.
- No live smoke tests could be run.
- Adapters are tested against fixtures built from the published response shapes. A configured environment must re-verify them before enabling.

## Erasure order (A1–A4)

Media originals, `media_analyses` and the other append-only tables can be deleted only with `app.erasure = 'on'` set in the transaction. The erasure routine is not implemented yet (it belongs with the data protection workflow). When it is built, it must delete `media_analyses` and `evidence_links` before `media_assets`, because the foreign keys use `restrict`.

## Reconciliation with the England release

`main` shipped an independent England property-intelligence release (migrations 0006–0009, applied to a non-production Neon database). When this branch merged, main's schema was kept as the base and this branch's work was rebuilt on top of it:

- **Migrations.** Main's 0006–0009 are unchanged. This branch's schema arrives as one generated migration, `0010_surveynt_assistant_and_learning`. Its hand-written security migrations follow as 0011–0022, in their original order. Nothing in 0010–0022 drops, renames or retypes anything main created.
- **Shared columns and tables.** `properties` identity columns, `enrichment_runs` and `property_intelligence_snapshots` are main's.
  - This branch adds columns: `uprn_confirmed_at`, `uprn_evidence_type`, `identity_address_fingerprint`, `input_fingerprint`, `error`, `message`, `licence` and `confidence_label`.
  - It appends enum values: `location_confidence`, `enrichment_status`, `information_class` and `coverage_status`.
  - It writes main's required columns: `location_fingerprint`, numeric `confidence`, `attribution` and `licence_snapshot`.
  - `properties.location` is kept up to date by main's `properties_sync_location` trigger.
- **Database rules dropped from this branch.** The UK-bounds, confidence-versus-point and UPRN-confirmation checks are enforced by the identity service only, because main's code writes those columns under its own rules. Main's coordinate, range and UPRN-format checks remain.
- **Confidence vocabulary.** `normaliseLocationConfidence` maps main's `approximate` to "geocoded, unconfirmed", and `confirmed`/`exact` to "surveyor confirmed".
- **Reference data: one store.** Main's `public` tables hold everything, whichever tool loads it:
  - `data_sources` gains this branch's register and operations columns (`register_status`, `definition`, verification, probe and release-check fields). `syncSourceRegistry` upserts register metadata and never changes `enabled` except to disable a blocked source.
  - `dataset_versions` gains `layer`, `source_crs`, `extent`, `imported_by`, `previous_active_id`, `completed_at` and `retired_at`. One version is active per source and layer; main's sources all use the empty layer. Status is derived: active flag, otherwise retired if it was ever activated, otherwise staged.
  - Failed imports are deleted with their rows, as main's scripts do, and the reason is kept in the `dataset_syncs` job log.
  - Rows live in `os_uprn_points`, `spatial_reference_features`, `price_paid_transactions`, `price_paid_uprn_links` and `scottish_epc_certificates`, all keyed by `dataset_version_id`.
  - Main's import scripts and `@surveynt/property-data` importers both write here. Main's activate and rollback scripts now manage the empty layer only.
- **Code.** Main's provider module is `@surveynt/property-data/england`, used by `lib/property-intelligence.ts` and main's worker. Its queue (`intelligence`) is separate from this branch's (`property_intelligence`).
- **Routes and screens.** Where both defined the same route (address search and resolve, property intelligence and its planning, environment and refresh views), this branch's versions are kept, because later phases depend on their response shapes. Main's identity-confirm and map routes, worker cron and scripts remain. Main's `properties/[propertyId]` page and `property-intelligence-workspace` component were removed: they collided with this branch's `properties/[id]` workspace and expected the replaced route shapes.

---

# England first release (merged from main)

The section below is the England release record from `main`, kept verbatim. Its schema (migrations 0006–0008) is the base this branch's migrations build on; see the reconciliation notes in [`architecture.md`](./architecture.md#reconciliation-with-the-england-release).

## Property intelligence architecture

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
