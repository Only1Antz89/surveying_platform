# Progress checklist

Legend for every row:

- **Code**: implemented and tested in the repository.
- **Configured**: credentials or flags set in a real environment.
- **Imported**: reference data loaded into a real database.
- **Live**: smoke-tested against the real provider.

"—" means not applicable. Nothing is configured, imported or live-tested from this build environment. Its egress policy blocks every provider host (see [`architecture.md`](./architecture.md#known-environment-constraint-p0)).

Execution order: P0 → A0 → P1 → A1 → P2 → A2 → P3 → P4 → A3 → A4 → P5 → A5 → P6 → A6 → L0–L4.

## P0 — Repository and source verification

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Repository assumptions confirmed or corrected with file references (`architecture.md`) | ✅ | — | — | — |
| Source register with official URLs, licence/coverage and status (`source-register.md`) | ✅ (all **pending**/**blocked**) | — | — | ❌ hosts blocked |
| Migration, role, PostGIS and background-job strategy documented | ✅ | — | — | — |
| Configuration inventory (`configuration.md`) | ✅ | ❌ | — | — |
| Baseline `pnpm check` green (fixed missing `@types/node` in `@surveynt/db`) | ✅ | — | — | — |
| Integration harness: local PostgreSQL 16 + PostGIS 3.4 via the Neon driver, app role without BYPASSRLS, baseline cross-tenant tests | ✅ | — | — | — |

## A0 — Field map and form template model

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| `@surveynt/assistant` with zod form-template schema, value states, inspection statuses and service scopes | ✅ | — | — | — |
| Surveynt-owned residential taxonomy `surveynt-residential@1.0.0` (no third-party standard text), fingerprint-pinned | ✅ | — | — | — |
| Field classes (clerical / factual_sourced / professional_assessment) with `fieldPolicy` and per-field proposal source allowlists | ✅ | — | — | — |
| [`docs/assistant/field-map.md`](../assistant/field-map.md) for priorities 1, 3, 4, 6 and 7 | ✅ (**requires qualified-surveyor review**) | — | — | — |
| UK country enum shared in `@surveynt/domain` | ✅ | — | — | — |

## P1 — Property identity

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Migrations 0006–0008: PostGIS extension; `reference` schema; NOLOGIN group roles `surveynt_reference_read` and `surveynt_reference_write`; nullable identity columns on `properties` (country, text UPRN, lat/lon, generated `geometry(Point,4326)`, confidence, method, evidence) with UK-bounds, pair, format and confirmation CHECKs | ✅ | ❌ not applied to any Neon branch | — | — |
| `property_identity_events` (append-only trigger, RLS, composite tenant FK); `address_lookups` (tenant cache, RLS); `provider_rate_limits`; `provider_response_cache` (public data only) | ✅ | ❌ | — | — |
| `reference.data_sources` (operator-controlled `enabled` + `verified_at`), `reference.dataset_syncs` (one active version, rollback reference), `reference.os_open_uprn` (geography GiST) | ✅ | ❌ | — | — |
| `@surveynt/property-data`: allowlisted fetch (HTTPS only, no redirects, size cap, timeouts, transient-only retry), contract types, matching rules, source registry | ✅ | — | — | — |
| Postcodes.io adapter (NI disabled pending LPS terms) | ✅ fixtures | ❌ | — | ❌ blocked host |
| Nominatim adapter: submit-only, deployment-wide DB rate gate, identifying User-Agent, tenant-scoped cache | ✅ fixtures | ❌ | — | ❌ blocked host |
| UPRN candidate search (metre radius by confidence: 250/75/30 m), never auto-selects, flags co-located flats, GB-only coverage | ✅ | — | — | — |
| OS Open UPRN importer CLI: checksum, header validation, regional bbox, staging, BNG↔ETRS89 cross-check, atomic activation, rollback, prune | ✅ (synthetic fixture) | ❌ | ❌ no real release imported | — |
| `GET /api/v1/address/search`, `POST /api/v1/address/resolve`, `GET/PUT /api/v1/properties/:id/identity`, `country` on create | ✅ | — | — | — |
| UI: optional submit-only search in "New property" (manual entry always works), property record page with Overview/Surveys tabs, identity panel with evidence-backed UPRN confirmation and history | ✅ (demo smoke-tested) | — | — | — |

Acceptance:

- Manual create/edit works for old and new records (the columns are nullable; the browser smoke test covered manual edit after search).
- A postcode centroid never yields an exact UPRN (`assessUprnCandidates.autoSelectable` is always false, plus the confidence ceiling).
- Multiple co-located flats stay ambiguous, with an explicit warning.
- Cross-tenant identity changes and lookups fail (integration-tested).
- Coordinate, CRS and distance validation pass (integration-tested).

## A1 — Survey, observation and evidence core

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Migrations 0009–0010: `surveys` (template key, version and fingerprint pinned; jurisdiction; scope), `survey_elements` (inspection status and limitation), append-only `survey_field_values`, `observations` (current / measurement / client claim / historical / external kinds), immutable `media_assets` originals, `evidence_links`, `assistant_tasks`, `sync_operations` ledger; RLS and composite tenant FKs on all of them; erasure-only deletes | ✅ | ❌ not applied to any Neon branch | — | — |
| Shared sync contract (`@surveynt/assistant` capture) and deterministic reinspection tasks from same-firm history (same property record or surveyor-confirmed UPRN only) | ✅ | — | — | — |
| Survey service: create/pin, pack, ordered idempotent sync with conflicts, professional-judgement restriction, revisions that carry evidence, media storage idempotent by client id | ✅ | — | — | — |
| Storage adapter: Vercel Blob private (`put`/`get`/`del`); in-memory for tests | ✅ | ❌ no Blob store configured | — | ❌ |
| APIs: `GET/POST /jobs/:id/survey`, `GET /surveys/:id`, `POST /surveys/:id/sync`, `POST /surveys/:id/media`, `GET /media/:id` | ✅ | — | — | — |
| Survey workspace: template-driven form, explicit value states, observations, photos, sync bar, conflict resolution, history reminders; linked from the job record | ✅ | — | — | — |
| Offline: per-user/firm IndexedDB pack, outbox and photo queue; service worker shell cache; 30-day expiry; "Remove offline copy" ([`../assistant/offline.md`](../assistant/offline.md)) | ✅ (browser-tested in demo) | — | — | — |

Acceptance:

- An observation entered once is reusable through the pack, evidence links and history.
- A restart or lost connection recovers queued data: offline reload and resync were browser-tested.
- Duplicate retries are idempotent and conflicts are surfaced, not overwritten.
- There is no cross-tenant history access (integration-tested): another firm's observations of the same UPRN and address-only matches are excluded.

## P2 — Core property intelligence

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Migrations 0011–0012: `enrichment_runs` (idempotency key, input fingerprint, per-provider statuses), immutable `property_intelligence_snapshots` (all brief fields: source, dataset version, record id, category, schema version, data, evidence, match method, confidence, information class, coverage/result status, licence snapshot, retrieval/source/expiry dates), `background_jobs.locked_until` lease, layer-aware `reference.dataset_syncs`, generic `reference.spatial_features` (geometry(Geometry,4326)); RLS + composite tenant FKs | ✅ | ❌ | — | — |
| Provider framework: applicability (unsupported / not_configured / too approximate), orchestrator with outer timeouts, concurrency limit, transient-only retry, failure isolation | ✅ | — | — | — |
| Planning Data adapter (England; point-in-area; per-dataset "no record found"; partial coverage) | ✅ fixtures | ❌ source not enabled | — | ❌ blocked host |
| EPC adapter (England & Wales; **exact confirmed UPRN only**; no address fields stored; age band normalised) | ✅ fixtures | ❌ credentials | — | ❌ blocked host |
| Historic England via imported NHLE layers (reference-layer provider; intersects = match, nearby = separate indicative context; unimported layer = not checked) | ✅ synthetic layer | ❌ | ❌ no real release imported | — |
| Generic spatial layer importer (GeoJSON/GeoJSONSeq, optional `ogr2ogr` conversion, attribute allowlists, UK-extent and validity checks, staged/atomic/per-layer activation) | ✅ | — | — | — |
| Durable orchestration: idempotent refresh + 10-minute reuse window, `after()` accelerator, leased jobs, queue consumer `/api/queues/intelligence`, daily cron sweep, fingerprint checks before and after provider calls | ✅ | — | — | — |
| APIs: intelligence (+ planning/environment views), refresh, run status | ✅ | — | — | — |
| UI: Intelligence, Planning and Sources tabs; information-class labels; per-source status/freshness/coverage/confidence/evidence; fixed caveats; stale marking | ✅ | — | — | — |
| Survey binding: `link_evidence` accepts an immutable snapshot id from the same property | ✅ | — | — | — |

Acceptance:

- Real adapters normalise validated responses and attach source, licence and coverage metadata.
- One failed provider does not lose successful results (run status `partial`, integration-tested).
- Missing or unsupported data shows as Not checked or No record found.
- Refresh is permission-checked, rate-limited and idempotent; surveyor observations are never written by enrichment.

## A2 — Proposals and discrepancies

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Migrations 0013–0014: `field_proposals` with every contract field (id, organisation_id, survey_id, element_id, field_path, proposed_value, value_type, evidence_refs, origin_class, limitations, review_status, input_version, model/prompt/knowledge versions, created_at), plus base value, generator and dedupe key; RLS; trigger keeps content immutable and review one-way | ✅ | ❌ | — | — |
| Deterministic sourced generator (`sourced-records-v1`): EPC → type, form, period, rating; heritage → listed status and grade (agreement required); planning → conservation area; job → clerical inspection date. Per-field source allowlists; "no record found" carries a not-proof limitation | ✅ | — | — | — |
| Discrepancy tasks instead of silent replacement (surveyor value vs source; disagreeing sources) | ✅ | — | — | — |
| Review service: accept/edit/reject; stale proposals refused and superseded; professional assessments need a surveyor role plus explicit confirmation; accepted values carry origin, source ids, event date, retrieval date and evidence links; rejections kept as evaluation feedback | ✅ | — | — | — |
| Event triggers: survey creation, sync with field edits (`after()`), enrichment completion | ✅ | — | — | — |
| `AssistantModel` interface, `noProviderModel` (unavailable), untrusted-content envelope, post-call validation (requested fields only, permitted values, citations limited to supplied evidence, no photo-only professional assessments) | ✅ | ❌ no provider (by decision) | — | — |
| APIs and survey panel for suggestions and discrepancies | ✅ | — | — | — |

Acceptance:

- Every material suggested fact carries an evidence reference to an immutable snapshot or job record.
- Historical defects stay as reinspection reminders (A1), never findings.
- A stale suggestion cannot overwrite a surveyor's edit (integration-tested).
## P3 — Land and environmental context
## P4 — Property history
## A3 — Adaptive rules and completion checks
## A4 — Photo and document proposals
## P5 — Data engine and administration
## A5 — Wording library and report assembly
## P6 — Country-specific expansion
## A6 — Pilot readiness and AI governance
## L0–L4 — Shared learning (disabled by default)

## Validation log

| Date | Command | Result |
|---|---|---|
| 2026-10-01 | `pnpm check` (baseline, before changes) | ❌ `@surveynt/db` lint: missing Node types |
| 2026-10-01 | `pnpm check` (after adding `@types/node` to `@surveynt/db`) | ✅ lint, typecheck, 20 tests, build |
| 2026-10-01 | `TEST_DATABASE_URL=… pnpm --filter @surveynt/db test:integration` | ✅ 3 tests (migrations 0000–0005 apply; cross-tenant read/update blocked; no context returns nothing) |
| 2026-10-01 | `pnpm check` after P1 | ✅ lint, typecheck, 54 unit tests, build |
| 2026-10-01 | `pnpm --filter @surveynt/property-data test:integration` | ✅ 9 tests: registry disabled by default, staged import and atomic activation, metre-accurate candidates, app role read-only on reference, importer denied tenant tables, failed import keeps active version, activation and rollback, property CHECKs, immutable tenant-scoped identity events |
| 2026-10-01 | `pnpm --filter @surveynt/web test:integration` | ✅ 5 tests: cached postcode lookup and tenant-scoped lookups, centroid resolution never auto-selects, evidence-required UPRN confirmation with history and audit, cross-tenant update denied, deployment-wide rate gate |
| 2026-10-01 | Playwright smoke (demo mode, production build) | ✅ search fills editable fields, labelled demo results, ambiguity warnings, confirmation form, Surveys tab, no console errors, no horizontal overflow at 390 px |
| 2026-10-01 | `pnpm --filter @surveynt/web test:integration` (A1) | ✅ 12 tests, including 7 survey tests: jurisdiction and template pinning, tenant- and UPRN-scoped history reminders, idempotent replay, conflict instead of overwrite, append-only history, professional-judgement restriction, evidence carried on revision, media idempotency, immutability, cross-tenant denial, template integrity stop |
| 2026-10-01 | `pnpm --filter @surveynt/web test:integration` (P2 additions) | ✅ 5 intelligence tests: idempotent refresh, a single concurrent claim, partial run with EPC 503, imported layer match/nearby/not-imported, attribute allowlist, snapshot immutability, stale identity, superseded run without provider calls, expired-lease reclaim, cross-tenant denial |
| 2026-10-01 | `pnpm --filter @surveynt/web test:integration` (A2 additions) | ✅ 6 proposal tests: generation from real enrichment snapshots, idempotent refresh, accept/edit/reject provenance and evidence links, no recreation after rejection, stale suggestion blocked after edit with discrepancy raised, professional confirmation, immutability, identity change supersedes, cross-tenant denial |
| 2026-10-01 | Playwright offline test (demo mode, production build) | ✅ element status synced online; offline observation and field edit saved on device; offline reload restored both via service worker shell + IndexedDB; back online → "All changes synced"; no console errors; no overflow at 390 px |
