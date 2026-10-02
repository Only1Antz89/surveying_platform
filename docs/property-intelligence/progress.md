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

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Reference-layer providers over `reference.spatial_features`: INSPIRE (indicative extent, England & Wales), EA Flood Zones 2 and 3 (planning), EA surface water (high/medium/low, kept separate), BGS Geology 625k (bedrock and superficial, Great Britain), Natural England designations (SSSI, SAC, SPA, Ramsar, National Landscape, National Park, ancient woodland; nearby context for SSSI and ancient woodland) | ✅ synthetic layers | ❌ sources not enabled | ❌ no real release imported | — |
| Per-layer attribute allowlists (INSPIRE keeps `INSPIREID` only); CLI overrides for real column names; independent per-layer versions, activation and rollback | ✅ | — | — | — |
| Spatial query service: point-in-polygon on the active version; geography distances for nearby context; approximate locations (postcode centroid) and uncovered countries return `unsupported` | ✅ | — | — | — |
| Bounded, simplified GeoJSON for the map (`featuresNear`: 300 m, max 500 features per layer, simplified geometry) and `GET /api/v1/properties/:id/map` | ✅ | — | — | — |
| Land & Map tab: MapLibre with layer toggles, per-layer attribution and caveats, a "Not checked" list (source not enabled, not imported, no coverage in the country, country not set), WebGL-failure fallback | ✅ (demo smoke-tested) | ❌ no basemap provider | — | — |
| Basemap: `NEXT_PUBLIC_MAP_STYLE_URL`; unset shows "Basemap not configured" over a plain background (no public OSM tiles) | ✅ | ❌ **blocked: needs a contracted or self-hosted tile provider** | — | — |
| MapLibre worker served from `public/vendor/maplibre-gl/<version>/` (copied at build) | ✅ | — | — | — |
| `ASSISTANT_ENABLED` kill-switch, documented in A2, now enforced (generation, listing, review) | ✅ | ❌ | — | — |

Acceptance:

- Known inside, outside and boundary points give the expected flood-zone answers (integration-tested on synthetic squares).
- INSPIRE is labelled indicative ("not a legal title boundary"), and no title number reaches stored attributes.
- A failed import (coordinates outside the UK) keeps both active flood-zone layers.
- England-only layers return `unsupported`/`not_covered` for Wales, and postcode-centroid locations are refused.
- An unimported layer is `null` for the map and "not configured" in intelligence, never "no record".
## P4 — Property history

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Migrations 0015–0016: `reference.price_paid_transactions` (transaction id, price, date, type, new build, tenure, category; **no address columns**) and `reference.price_paid_uprn_links` (transaction id ↔ UPRN, many-to-many), versioned by `dataset_syncs`; app read-only, importer write | ✅ | ❌ not applied to any Neon branch | — | — |
| Price Paid importer: 16-column validation, `full` and monthly `update` modes (A/C/D applied by transaction id on a copy of the active version), regional postcode-area filter used transiently, rejection threshold, atomic activation, rollback | ✅ synthetic files | ❌ sources not enabled | ❌ no real release imported | — |
| Transaction-to-UPRN look-up importer: header detection or explicit columns, headerless files, multi-UPRN links counted | ✅ synthetic files | ❌ | ❌ | — |
| `hmlr_price_paid` provider: England & Wales, **confirmed UPRN only**, exact look-up links only; unimported/disabled look-up and areas outside a regional import are "Not checked"; no linked sale is `no_match` with partial coverage and a not-proof caveat; shared multi-property sales flagged | ✅ | — | — | — |
| `GET /api/v1/properties/:id/history` and History tab: sales, energy certificates, listings and designations from stored snapshots plus the firm's job-stage and survey events; separate event, publication and retrieval dates; stale marking; per-source coverage notes | ✅ (demo smoke-tested) | — | — | — |

Acceptance:

- Sales link by exact transaction id ↔ UPRN only. There is no fuzzy or address matching (integration-tested: a sale linked to another UPRN never appears).
- Corrections (C) and deletions (D) produce a new version; rollback restores the previous one (integration-tested).
- No Price Paid address field is stored, returned or quoted in errors (integration-tested on table columns and responses).
- A missing link or unimported dataset is never shown as "no sales".
- Other firms' job events at the same UPRN never appear (integration-tested).

Blockers:

- The look-up was announced for 28 Aug 2026 (OGL). Its exact header names and release form could not be checked from this environment, so the importer detects or accepts them.
- Real data needs the operator steps in [`configuration.md`](./configuration.md#importing-price-paid-data-and-the-transaction-to-uprn-look-up-p4) and source enablement after licence verification.
## A3 — Adaptive rules and completion checks

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Versioned, declarative rule set `surveynt-residential-rules@1.0.0`, pinned to template 1.0.0. Each rule has an id, trigger, requirements, justification, severity (`hard_gate`/`advisory`) and permitted override reasons. Covers flats (communal areas and tenure), extensions (approvals), limited inspections (limitation), rating 3 (commentary), defects (location, evidence, next action), listed grade and roof-space general limitation | ✅ (**requires qualified-surveyor review**) | — | — | — |
| Pure completion engine shared by the browser (offline) and the server: required fields per service level, inspection statuses, status/rating contradictions, open discrepancies, unreviewed AI text, report photos, unreviewed suggestions and reminders, with a stable full checklist | ✅ | — | — | — |
| Stage gate in `PATCH /api/v1/jobs/:id` for `internal_review` and `issued`: 422 `completion_checks_failed` with failures, unless every hard gate has a permitted reason from a surveyor role. Runs inside the stage-change transaction | ✅ | — | — | — |
| Migrations 0017–0018: `completion_overrides` (tenant RLS, composite FKs, immutable) plus an audit event per override | ✅ | ❌ not applied to any Neon branch | — | — |
| Defect classification on observations (next action; surveyor roles only), location, and linking photos to observations as evidence | ✅ | — | — | — |
| UI: completion panel in the survey workspace (jump to element, full checklist); stage gate dialog in the jobs register with permitted reasons | ✅ (demo smoke-tested) | — | — | — |
| `GET /api/v1/surveys/:id/completion`; [`docs/assistant/completion-rules.md`](../assistant/completion-rules.md) | ✅ | — | — | — |

Acceptance:

- Complete fixtures pass at every service level. Each rule fails in isolation when broken, and the checklist ids are stable (unit-tested).
- Coordinators cannot override. Surveyors need a permitted reason, and "other" needs a note. Unreviewed AI text, missing limitations and contradictions cannot be overridden (unit and integration-tested).
- Overrides are stored immutably, audited and tenant-isolated (integration-tested).
## A4 — Photo and document proposals

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| `@surveynt/evidence`: deterministic photo quality (`photo-quality-v1`: resolution, Laplacian blur measure, exposure; blur not judged under extreme exposure; HEIC/damaged files "unavailable") and PDF text-layer reading (unpdf, page-limited, no rendering or scripts) | ✅ synthetic images and PDFs | — | — | — |
| `certificate-facts-v1` in `@surveynt/assistant`: certificate type, reference and dates with page and character spans; day-first dates only, two-digit years refused; instruction-like text reported and ignored; expiry and due-soon checks against the inspection date | ✅ | — | — | — |
| Migrations 0019–0020: `media_analyses` (one per media and analyser version; tenant RLS; append-only; deletable only by erasure) | ✅ | ❌ not applied to any Neon branch | — | — |
| Analysis after upload (`after()`) plus a daily backfill sweep; an expired certificate raises a discrepancy task with the document span, which the A3 gate enforces | ✅ | ❌ needs a Blob store | — | — |
| UI: quality hints under photos; "Certificates and documents" panel (PDF upload, facts with page references, checks, limitations, open original); earlier photos of the same element for comparison on site, labelled possible change only | ✅ (demo smoke-tested) | — | — | — |
| Image understanding, OCR and tag suggestions | — (unavailable: no AI provider, by decision) | — | — | — |
| Evaluation pack `packages/evidence/eval` (11 labelled synthetic cases: blur, darkness, low resolution, misleading scale, damp-like staining, stale certificate, prompt injection, scanned document, ambiguous date, no-record, repaired old defect) and [`docs/assistant/evaluation.md`](../assistant/evaluation.md) | ✅ 11/11, abstentions 4/4, unsupported claims 0 | — | — | — |

Acceptance:

- No photo-only professional assessment: refused by validation, and image understanding is unavailable (evaluation pack).
- Document facts cite page and span. An expired certificate becomes a discrepancy that blocks the move to review until it is resolved or explained (integration-tested).
- Injected instructions in a document change nothing (integration and evaluation tested).
- Earlier photos come only from the same firm and the same property or confirmed UPRN, never another firm's (integration-tested).
## P5 — Data engine and administration

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| `/platform/data-sources` (super admin or compliance to act; others view): register status, enablement with recorded verification, active versions per layer, import history with validation and errors, freshness, health; enable/disable, release check, probe, activate staged versions, roll back; every action audited | ✅ (demo smoke-tested) | ❌ needs `DATABASE_ADMIN_URL` and platform staff | — | — |
| Freshness policy per source (release-check window for bulk datasets; live APIs per request), and a "newer dataset version active" flag on stored intelligence | ✅ | — | — | — |
| Cache invalidation on activation and rollback (public response cache cleared per source, from the UI or the CLI); migration 0022 lets the importer clear, but not write, the public cache | ✅ | ❌ | — | — |
| Health probes (postcodes.io, Planning Data; Nominatim never probed under its usage policy; EPC not until a status endpoint is confirmed) and a daily sweep for probes and due release checks | ✅ | ❌ | — | ❌ hosts blocked here |
| Migration 0021: probe and release-check columns on `reference.data_sources` (operator-only) | ✅ | ❌ | — | — |
| [`runbook.md`](./runbook.md): lifecycle, rollback and recovery, the daily sweep, synthetic benchmark results, national scale-up estimates, cost categories | ✅ | — | — | — |
| Fixed: EPC cache keys used the prefix `epc` instead of the source key, so they could not be invalidated by source | ✅ | — | — | — |

Acceptance:

- Enabling needs a verification note, and blocked sources cannot be enabled (integration-tested).
- Activation and rollback are atomic per layer, clear only that source's cached responses, and are audited (integration-tested).
- Release checks reset freshness; a source with no import or check in its window is listed as due (integration-tested).
- The app and importer roles cannot change operator metadata; the importer cannot write cache entries (integration-tested).
## A5 — Wording library and report assembly

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Migrations 0023–0024: `wording_clauses` (versioned; one approved per key; drafts editable; approved immutable except retirement; licensed wording needs a licence reference), `report_versions` (immutable content, trace, input fingerprint, hashes), `report_approvals` (immutable sign-off); RLS and composite tenant FKs | ✅ | ❌ not applied to any Neon branch | — | — |
| Deterministic composer: recorded values, current observations and approved clauses only; limitation text only for uninspected elements; client statements labelled; recommendations from defect next actions; rating summary; placeholders filled or the clause skipped; every block traced | ✅ | — | — | — |
| Wording library page and API: drafts (surveyor roles), approval and retirement (owners and administrators), version history | ✅ (demo smoke-tested) | — | — | — |
| Report panel: compose, preview with per-block sources, explicit sign-off statement, reopen; survey workspace side column | ✅ (demo smoke-tested) | — | — | — |
| Sign-off rules: latest version, unchanged inputs, completion hard gates resolved or overridden, surveyor role; capture closes on sign-off | ✅ | — | — | — |
| Issue gate: a current signed-off version, or a recorded reason (A3 override) | ✅ | — | — | — |
| [`docs/assistant/report-assembly.md`](../assistant/report-assembly.md) | ✅ | — | — | — |

Acceptance:

- Drafts, retired wording and other jurisdictions' wording never appear. Uninspected elements carry limitation text only (unit-tested).
- Approved wording cannot be edited or deleted. Report versions and sign-offs cannot be edited (integration-tested).
- An edit after composing makes the version out of date. Only the latest unchanged version can be signed off, and only by a surveyor role with the explicit statement (integration-tested).
- Issue is blocked when the survey changed after sign-off (integration-tested).
## P6 — Country-specific expansion

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Registry: SEPA flood maps (pending); Northern Ireland EPC and Pointer (blocked, never used); existing NRW, Cadw, HES, Scottish EPC and NI listed-building entries | ✅ | ❌ all pending or blocked | — | ❌ hosts blocked |
| Reference-layer providers with their own categories: NRW Flood Map for Planning (Wales), Cadw (Wales), HES designations (Scotland), SEPA flood likelihood (Scotland), DfC HED listed buildings (Northern Ireland); on the property map too | ✅ synthetic layer | ❌ | ❌ no real release imported | — |
| Scottish EPC Register importer (header detection or explicit columns; UPRN-keyed; no address fields; impossible dates and ratings dropped) and provider (Scotland, confirmed UPRN only); migrations 0025–0026 | ✅ synthetic extract | ❌ | ❌ | — |
| Country routing: providers decline outside registered coverage (`not_covered`); no category shared between nations; blocked sources never run | ✅ (unit-tested for every provider × country) | — | — | — |
| Generated [`country-coverage.md`](./country-coverage.md) with a drift test; coverage line in the Intelligence panel | ✅ | — | — | — |
| Northern Ireland address resolution and EPC | — **unsupported by design** (no licence or open data) | — | — | — |

Acceptance:

- A Welsh property gets NRW flood zones and never EA zones; an English property never gets NRW zones (integration-tested).
- Scottish certificates match by exact UPRN only. Unlinked rows are counted, not guessed, and no address is stored (integration-tested).
- England results are never shown as Wales, Scotland or Northern Ireland coverage (unit-tested for every provider).

Blockers: every devolved source is pending verification, and the official hosts are blocked from this environment. Column names for the Scottish EPC extract and the layer presets are provisional; the importer accepts overrides.
## A6 — Pilot readiness and AI governance

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Migrations 0027–0028: `ai_model_register` (platform; app role read-only), `organisation_ai_settings`, `ai_consent_records` (append-only), `ai_risk_assessments` (approved ones immutable, superseded on re-approval), `ai_incidents` (closing needs a correction note); FORCE RLS on tenant tables | ✅ | ❌ not applied to any Neon branch | — | — |
| Governance gate: provider, register approval for the use, firm switch and permitted use, in-date approved risk assessment, current client consent against the latest disclosure, no open critical incident; every failing reason listed | ✅ (unit- and integration-tested) | ❌ no provider (`AI_PROVIDER=none`) | — | — |
| `governedModelFor()` as the only route to a model; ESLint forbids the model factories elsewhere | ✅ | — | — | — |
| Firm page Settings → AI and assistant; job record consent panel with per-use status and history | ✅ (demo smoke-tested) | ❌ AI off for every firm | — | — |
| Platform page Assistant: model register (propose, approve with evaluation summary, suspend, retire) and aggregate metrics (no firm named) | ✅ (demo smoke-tested) | ❌ register empty | — | — |
| [`docs/assistant/pilot.md`](../assistant/pilot.md): gate, records, metrics, pilot stages with thresholds "to be set by qualified surveyors", incident handling, fine-tuning feasibility "not started" | ✅ | — | — | — |

Acceptance:

- Every use is blocked by default and reports why (integration-tested).
- Enabling needs a disclosure. Consent can only cover permitted uses. A disclosure change makes earlier consent out of date. Withdrawal stops use at once (integration-tested).
- A use is allowed only when every condition holds. Suspending the register entry or opening a critical incident blocks it again (integration-tested).
- Consent and approved assessments cannot be edited. The app role cannot change the model register. Firms cannot read or write each other's records (integration-tested).
- No AI adapter exists. Even an allowed gate yields a model that answers "unavailable" until an adapter is written and evaluated.

Blockers: choosing an AI provider; reviewing its data-processing terms; legal review of the client disclosure; pilot thresholds from qualified surveyors.
## L0–L4 — Shared learning (disabled by default)

### L0–L1 — Policy, controls, restricted staging and privacy review

| Item | Code | Configured | Imported | Live |
|---|---|---|---|---|
| Policy documents: [`policy.md`](../shared-learning/policy.md), [`privacy-assessment.md`](../shared-learning/privacy-assessment.md) (working draft, not a DPIA), [`seed-corpus.md`](../shared-learning/seed-corpus.md) | ✅ | ❌ not reviewed by legal, DPO or qualified surveyors | — | — |
| Migrations 0029–0030: `learning_policy_versions` (platform; one published; published immutable), `learning_contribution_grants` (append-only, confirmations required), `learning_withdrawal_requests` (can only be completed), platform roles `privacy_reviewer`, `technical_reviewer`, `release_manager`; `learning_restricted` schema (candidates with immutable lineage, append-only erasable sanitisation runs and reviews, append-only audit log); roles `surveynt_learning_write` and `surveynt_learning_read`; firm-scoped summary function | ✅ | ❌ not applied; no learning login role exists | — | — |
| Programme gate: `SHARED_LEARNING_ENABLED`, a published policy with a privacy assessment reference and release criteria validated against `releaseCriteriaSchema` | ✅ | ❌ flag off, no policy | — | — |
| `@surveynt/learning`: eligibility gate, minimal per-element extraction, deterministic sanitiser `sanitiser-v1` (known identifiers plus patterns, date and age generalisation, location labels dropped, residual capitalised terms listed), rare-combination generalisation and quarantine, photo metadata stripping and cropping (`photo-strip-v1`) | ✅ (15 unit tests) | — | — | — |
| Learning service: extraction from signed-off surveys through the tenant connection, writes through the learning role, keyed-HMAC lineage, ledger in the restricted audit log | ✅ | ❌ `DATABASE_LEARNING_URL`, `LEARNING_LINEAGE_SECRET` unset | — | — |
| Privacy review queue (privacy reviewers only; six checks to approve, a reason to reject) | ✅ | — | — | — |
| Withdrawal propagation (copies cleared, sanitisation and reviews erased, lineage and audit kept; revocation withdraws; daily sweep retries) | ✅ | — | — | — |
| Firm page Settings → Shared learning; platform page Shared learning (policy, pipeline counts, privacy queue, sweep) | ✅ (demo smoke-tested) | — | — | — |

Acceptance (L1 gate: "identifier/linkage tests, access isolation and rejection paths pass"):

- Off by default: nothing can be granted or extracted. Publishing needs a privacy assessment reference and complete criteria. Published policies are immutable (integration-tested).
- Extraction needs the flag, the policy, the firm's confirmed grant and a signed-off report. It runs once per report version. Staged output contains none of the seeded names, address, phone or reference. The first cases of a combination are held as rare (integration-tested; sanitiser unit-tested for identifiers and dates).
- The tenant role cannot read restricted staging. The learning role cannot read tenant tables. Lineage, reviews and sanitisation results cannot be edited (integration-tested).
- Only privacy reviewers decide. Approval needs every check and rejection needs a reason. Decisions are audited (integration-tested).
- Withdrawal clears copies and keeps only lineage and audit. Revocation withdraws (integration-tested).
- Linkage testing against real public sources is a **manual reviewer step**. It is not automated, and no real data exists to test it on.

Blockers: legal and DPO review of the policy and privacy assessment; release criteria from qualified reviewers; a learning login role and secrets; reviewers appointed. The ICO pages could not be read from this environment.

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
| 2026-10-01 | `pnpm --filter @surveynt/property-data test:integration` (P3) | ✅ 14 tests, including 5 spatial tests: inside/outside/boundary flood-zone answers, INSPIRE indicative with id-only attributes, unsupported country and centroid refusal, failed import keeps active layers, bounded map features and unimported layer |
| 2026-10-01 | `pnpm --filter @surveynt/web test:integration` (P3) | ✅ 24 tests, including the new assistant kill-switch test |
| 2026-10-01 | `pnpm check` (P3) | ✅ lint, typecheck, 76 unit tests, build |
| 2026-10-01 | Playwright Land & Map smoke (demo mode, production build) | ✅ first run found MapLibre's worker failing to load from the bundle (fixed by serving it from `public/vendor`); rerun: labelled demo polygon drawn, marker, attribution shown, toggle works, "Basemap not configured" and "Not checked" shown, no external hosts contacted, no console errors, no overflow at 390 px |
| 2026-10-02 | `pnpm check` (P4) | ✅ lint, typecheck, 87 unit tests (11 new Price Paid parser and provider tests), build |
| 2026-10-02 | `pnpm test:integration` (P4, all suites) | ✅ 51 tests: db 3, property-data 21 (7 new history tests: regional import with no address columns, header detection and multi-UPRN links, exact linkage with unresolved links counted, A/C/D update and rollback, failed import keeps active version, headerless look-up, app role read-only, disabled look-up reported as unavailable), web 27 (3 new timeline tests: merged sales and firm events with separate dates, unconfirmed UPRN explained, stale after identity change, cross-firm denial). The first run caught a "2026-09" release being widened to "2026-09-01" by the snapshot timestamp; the label is now kept as published |
| 2026-10-02 | Playwright History smoke (demo mode, production build) | ✅ History tab, coverage notes, four labelled demo events in date order, event/published/retrieved dates shown separately (a month release shown as a month), no console errors, no overflow at 390 px |
| 2026-10-02 | `pnpm check` (A3) | ✅ lint, typecheck, 99 unit tests (12 new rule-engine tests with complete fixtures for all four service levels), build |
| 2026-10-02 | `pnpm test:integration` (A3, all suites) | ✅ 55 tests, including 4 new gate tests: not gated without a survey or for other stages; incomplete survey blocked, then passes when complete; coordinator cannot override; unlisted reason refused; permitted override stored immutably with audit and tenant isolation; defect classification limited to surveyors; defect gated until a photo is linked |
| 2026-10-02 | Playwright A3 smoke (demo mode, production build) | ✅ completion panel (42 to resolve, 2 advisory, jump to element), defect classification options, jobs register move to internal review opens the gate dialog listing failures that must be resolved, no console errors, no overflow at 390 px |
| 2026-10-02 | `pnpm check` (A4) | ✅ lint, typecheck, 108 unit tests (new: 4 certificate extractor tests, 4 analyser tests, the 11-case evaluation pack), build with sharp and unpdf kept as server externals |
| 2026-10-02 | `pnpm --filter @surveynt/evidence eval` | ✅ 11/11 passed, abstentions 4/4, unsupported claims 0. Finding fixed during calibration: the blur measure is meaningless under extreme exposure, so blur is no longer judged there |
| 2026-10-02 | `pnpm test:integration` (A4, all suites) | ✅ 59 tests, including 4 new analysis tests: photo hints idempotent and in the pack; certificate facts with spans; expiry discrepancy that gates completion; injected instructions change nothing; append-only and tenant-scoped analyses; backlog sweep; earlier photos same-firm only |
| 2026-10-02 | Playwright A4 smoke (demo mode, production build) | ✅ documents panel (upload disabled in demo, labelled), earlier-photo control hidden in demo, no console errors, no overflow at 390 px |
| 2026-10-02 | `pnpm check` (P5) | ✅ lint, typecheck, 110 unit tests (including new freshness tests), build |
| 2026-10-02 | `pnpm test:integration` (P5, all suites) | ✅ 66 tests, including 4 new operations tests (verified enablement, blocked refusal, atomic activation and rollback clearing only that source's cache, freshness and release checks, probes, role denial) and 3 new admin tests (audited actions, "newer dataset version" flag through activation and rollback, daily sweep) |
| 2026-10-02 | `pnpm --filter @surveynt/property-data benchmark` | ✅ synthetic: UPRN ~41,700 rows/s; spatial ~22,500 rows/s; Price Paid ~43,100 rows/s; look-up ~50,700 rows/s; p95 queries 5–15 ms (see runbook) |
| 2026-10-02 | Playwright P5 smoke (demo mode, production build) | ✅ Data sources page and navigation entry, 20 sources, blocked source cannot be enabled, demo action labelled as not saved, no console errors, no overflow at 390 px |
| 2026-10-02 | `pnpm check` (A5) | ✅ lint, typecheck, 115 unit tests (5 new composer tests), build |
| 2026-10-02 | `pnpm test:integration` (A5, all suites) | ✅ 70 tests, including 4 new report tests (wording lifecycle and immutability; traced, immutable version from approved wording only; sign-off rules and capture closing; issue gate and reopening) and the A3 gate test updated for the issue requirement |
| 2026-10-02 | Playwright A5 smoke (demo mode, production build) | ✅ side column beside the form at 1440 px; demo report composed with rating summary, limitation-only chimney text, recommendations and per-block sources; no sign-off in demo; wording library and editor; no console errors; no overflow at 390 px. Found and fixed: the preview was cleared by the reload after composing in demo |
| 2026-10-02 | `pnpm check` (P6) | ✅ lint, typecheck, 119 unit tests (4 new country-routing and coverage-document tests), build |
| 2026-10-02 | `pnpm test:integration` (P6, all suites) | ✅ 73 tests, including 3 new devolved-source tests (NRW-only flood answers for Wales, Scottish EPC import and exact-UPRN provider, header overrides) |
| 2026-10-02 | Playwright P6 smoke (demo mode, production build) | ✅ coverage line "15 of 23 registered sources cover England", Sources tab lists 23 sources, no console errors |
| 2026-10-02 | `pnpm check` (A6) | ✅ lint, typecheck, 123 unit tests (4 new gate tests), build |
| 2026-10-02 | `pnpm test:integration` (A6, all suites) | ✅ 81 tests (db 3, property-data 28, web 50), including 8 new governance tests: blocked by default with every reason; disclosure required and permitted uses only; full allow path with a test provider key, register approval and suspension; outdated disclosure and withdrawal; critical incident suspension and correction note; immutability, supersession and tenant isolation; app role cannot change the register; metrics name no firm |
| 2026-10-02 | Playwright A6 smoke (demo mode, production build) | ✅ Settings → AI and assistant (off, provider warning, demo label), job record consent panel (four blocked uses with reasons; recording disabled in demo), platform Assistant page and nav entry, no console errors, no overflow at 390 px. Found and fixed: stage-history timeline styles leaked into the consent list |
| 2026-10-02 | `pnpm check` (L0–L1) | ✅ lint, typecheck, 138 unit tests (15 new learning tests: programme and eligibility gates, sanitiser identifiers and dates, minimal extraction, generalisation, rarity quarantine, review schemas, curation weights, evaluation splits, training gate, EXIF and GPS stripping), build |
| 2026-10-02 | `pnpm test:integration` (L0–L1, all suites) | ✅ 87 tests (db 3, property-data 28, web 56), including 6 new shared-learning tests. The first run failed 4 unrelated web tests with "remaining connection slots are reserved": with 11 files in parallel the local server's 100 connections ran out. Web integration files now run one at a time (`--no-file-parallelism`) |
| 2026-10-02 | Playwright L0–L1 smoke (demo mode, production build) | ✅ Settings → Shared learning (inactive banner listing reasons, four scopes off, no grant or withdrawal controls in demo), settings navigation link, platform Shared learning page and navigation entry, demo grant API refused with `programme_inactive`, no overflow at 390 px. The only console error was that deliberate 409 |
