# Surveynt workspace rollout

Prepared locally on 8 October 2026. Deployment, migration of the live database and mobile distribution are separate operations.

## Stages and presentation switch

The application uses the approved demo’s blue, slate and white system across business, client and platform workspaces. `SURVEYNT_NEW_UI=false` restores the legacy shell/client presentation. This switch is independent of billing and feature entitlements; it does not undo database changes or enable integrations.

Apply migrations **0075–0078** using the repository’s normal administrator migration procedure after a backup. These add business locations, staff capabilities, platform/tenant connections, case publications, scoped conversations, tracking sessions, latest positions and explicit job movement confirmations. Tenant tables use forced RLS and tenant-scoped foreign keys. Platform credentials and support conversations are accessible only through administrator projections. The office backfill creates the initial location; unknown qualifications, operating bases, working hours and coverage remain unset and prevent eligible allocation.

Use the existing application-role grant procedure for the newly created tables and verify its RLS permissions before switching traffic. Never give the application role BYPASSRLS. No live migration was executed during this implementation.

## Connections

1. Set the exact comma-separated `SURVEYNT_OUTBOUND_HOSTS` allowlist on the server. Endpoints require HTTPS, public DNS addresses and no embedded credentials or query strings; DNS is pinned for each request. Redirects, restricted addresses, oversized responses and timeouts are rejected.
2. Store secrets in server environment variables named `SURVEYNT_CONNECTION_SECRET_*`. Platform Settings stores only these variable names. Credentials are masked and never returned to practice/client/mobile code.
3. A platform super administrator creates, checks and enables each routing, weather, traffic or OpenAI-compatible connection. Tenant detail selects an enabled connection and sets the AI model and monthly message limit. Practice settings reports capabilities and connection status.
4. AI models also require the existing AI register/governance approval. Conversational uses are `case_chat`, `business_chat` and `platform_chat`. Case consent is checked before and after the provider response. Unknown citations or uncited responses are rejected; generated professional findings and record changes require human action.

Routing endpoints implement OSRM `/route/v1/driving`. Road estimates are **not traffic-adjusted**. TfL `/Road/All/Disruption` reports London road-network coverage and retrieval time separately. Weather uses the Open-Meteo-compatible `/v1/forecast` current conditions endpoint. The public hosted Open-Meteo endpoint is forced to evaluation-only and cannot be assigned to a production practice. Configure an approved commercial/self-hosted endpoint and any key for production. Existing inspection archive weather remains separate.

References: [OSRM API](https://project-osrm.org/docs/v5.24.0/api/), [TfL open data](https://tfl.gov.uk/info-for/open-data-users/our-open-data), [Open-Meteo pricing](https://open-meteo.com/en/pricing).

## Records and permissions

Client case workspaces retain the existing secure quote token. They expose only that job’s authorised appointments, invoices, issued reports, released evidence and deliberately reviewed property-information excerpts. Raw intelligence payloads and internal stage reasons are not public. Property illustrations are labelled; geographic points do not claim title boundaries.

Owners/administrators manage locations and staff capabilities. Managers view profiles and confirm allocations. Qualifications are declared/reviewed by the practice, not externally verified with RICS. Recommendations require service qualification, configured coverage, capacity, working hours, availability and fresh connected calendars. Confirmation rechecks eligibility and serialises with booking. Reassignment removes only an unchanged Surveynt-owned event from the previous calendar using a conditional provider revision; external edits prevent removal and require calendar review.

A single Surveyant overlay retains its open state during workspace navigation. Case conversations attach to the job; business conversations use authorised practice records. Platform support conversations revalidate the existing approved support session, including expiry, before reading and after generating. Platform operational assistance otherwise uses aggregated operational data.

## Mobile tracking

See [mobile setup](../../apps/mobile/README.md). Sharing is explicit and ends on stop, configured workday end or 12 hours. Only the latest position is stored. Updates older than two minutes or preceding the session are rejected; stale offline coordinates are discarded. Failed stop requests are retried independently of coordinates. Manager views show accuracy, timestamp and sharing/stale status. Proximity is a hint; the surveyor confirms en route/on site/left site explicitly.

## Verification and release prerequisites

Local lint, type checks, unit/integration tests, full Next.js production build and Expo iOS/Android JavaScript exports were exercised. Integration tests used a disposable PostGIS instance and applied all migrations, never the production database. Existing payment, booking, invitation, report, retention and support tests were run alongside new tenant-boundary, allocation conflict, staff profile, public token and tracking tests.

No live routing/weather/traffic/AI credentials, real Clerk mobile JWT template, signed native builds or physical iOS/Android devices were available. Provider connection checks and physical backgrounding, screen lock, connectivity loss and revoked-permission checks remain mandatory before enabling these integrations or distributing the companion. JavaScript exports are not native/device verification. Browser preview uses the repository’s existing local fixtures; it is not evidence of live customer records or external provider connectivity.

Visual evidence and comparison: [UI review ledger](ui-review.md).

Final recorded checks: 70 web unit suites / 454 tests; 34 web integration suites / 249 tests, followed by the expanded six-test workspace suite including multi-site allocation; eight database isolation tests. Root lint/type checks and all ten production build tasks passed. Provider-data tests with unavailable external fixture infrastructure remain explicitly skipped by the repository suite.
