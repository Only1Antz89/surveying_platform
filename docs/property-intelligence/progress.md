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
- [ ] Additive identity columns, PostGIS, reference schema and group roles
- [ ] Postcode and Nominatim adapters; UPRN candidate query; matching rules
- [ ] Address search/resolve/identity routes; UI with manual fallback
- [ ] OS Open UPRN importer and a labelled synthetic fixture

## A1 — Survey, observation and evidence core
- [ ] Survey, element, field-value, observation, media and evidence tables
- [ ] Storage adapter (Vercel Blob, private)
- [ ] Sync API with idempotency and conflict detection; offline outbox

## P2 — Core property intelligence
- [ ] Registry, runs, snapshots, orchestrator
- [ ] Planning Data, EPC and Historic England adapters (disabled until verified)
- [ ] Intelligence and Sources UI

## A2 — Proposals and discrepancies
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
