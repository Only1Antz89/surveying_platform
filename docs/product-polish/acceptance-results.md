# Acceptance results (8 October 2026)

Local acceptance run on branch `claude/bold-carson-jrs2gd`: PR #3 merged, plus migration 0074. Environment:

- Production build (`next start`) and Chromium 141 via `playwright-core`.
- Disposable PostgreSQL 16 + PostGIS for the database-backed checks.

Nothing in this document was run against staging or production. No provider credentials were available.

## 1. Platform management persists into demo client accounts

### What was run

| Path | How it was signed in | Script | Result |
|---|---|---|---|
| Local preview (no Clerk keys; per-practice preview store) | Built-in demo platform operator (super administrator) and demo practice owner, in separate browser contexts | [`acceptance/platform-management.mjs`](../../acceptance/platform-management.mjs) | **19 of 19 passed** |
| PostgreSQL with Clerk-mode access resolution | Real `platformApiContext` and `apiContext` against the database, with Row-Level Security and audit. Only Clerk's `auth()` session lookup is substituted, because Clerk is unreachable here | [`apps/web/test/platform-support-persistence.integration.test.ts`](../../apps/web/test/platform-support-persistence.integration.test.ts) | **Passed** |

### Browser checks (local preview)

1. **Suspension**
   - Suspension persists after the operator reloads.
   - The practice workspace then shows "Workspace access is suspended" and has no client controls.
   - Reactivation persists and restores the client register.
2. **Write support access**
   - A write request appears to the practice owner on the Team page as awaiting approval.
   - Before approval, the session page returns 404 and API writes are rejected (401).
   - After the owner approves, the operator can open the session.
3. **Support-session changes**
   - In the approved session the operator creates a client, edits its name and phone, and adds a primary contact.
   - All of these appear in the practice's own register in a **separate browser session**, and still appear after a reload.
4. **Two-way and concurrency**
   - A practice-side rename appears in the support session.
   - A concurrent stale edit from the support session gets "The client was changed by another user. Reload before trying again." (409). The newer practice value is kept.
5. **Restrictions**
   - A read-only session shows no "New client" control, and its API writes are rejected (401).
   - Another demo practice's register does not show the record.

### Database checks (PostgreSQL)

- **Lifecycle**
  - A super administrator suspends the practice; the owner's API access is then refused.
  - Reactivation restores access.
  - A support-role operator cannot change tenant status (403).
- **Approval and writes**
  - Write access is refused until the owner approves; `approved_by_user_id` is recorded.
  - Support-session create, update and add-contact land in the practice's tenant rows.
  - The owner's own session lists and reads them, and can edit them.
- **Conflicts and attribution**
  - A stale support write returns 409; the support view shows the newer practice value.
  - Support writes are audited with `platform_staff_id` and `support_session_id`, and no practice user is recorded as actor.
  - The other practice's rows are untouched.
- **Session binding**
  - The session is bound to its operator; another support operator gets 401.
  - A read-only session can read but not write.
  - An expired session is refused.

### Not verified, and why

- **Real Clerk sign-in.** No Clerk keys are configured. The environment's network policy also blocks `api.clerk.com` (proxy returns 403). A staging run with real Clerk users remains required by the [release checklist](release-checklist.md): owner, a second signed-in session, and a platform operator. The browser script takes `SURVEYNT_URL` so it can be adapted to that run.
- **Hosted data.** Hosted Neon and Vercel were not touched.

## 2. Mobile, accessibility and offline

Scripts: [`acceptance/responsive-accessibility.mjs`](../../acceptance/responsive-accessibility.mjs) and [`acceptance/device-offline.mjs`](../../acceptance/device-offline.mjs).

Pages covered (15): landing, start, overview, jobs, job detail, survey workspace, customers, properties, calendar, routes, finance, documents, team, settings and platform customers.

### Defects found and fixed

| Defect | Where | Fix |
|---|---|---|
| Page-level horizontal scrolling at 360 and 390 px | Documents upload form: an unclassed `select` and file `input` were wider than their grid cell | `.field` controls are limited to the cell width |
| WCAG 1.4.3 contrast (axe, serious), light theme: status badges 4.29–4.49:1; demo label and blocker text 4.15–4.2:1 | Jobs, team, platform customers, routes, survey workspace | Darker success, warning and danger text tokens (5.6–5.8:1). Darker muted text inside the always-light survey workspace (5.3:1) |
| WCAG 1.4.3 contrast, dark theme: down to 1.03:1 | Quiet danger buttons (2.55:1); selected platform rows, active settings tab, colour field and start page left white | These now use theme tokens |
| WCAG 2.1.1 scrollable region not keyboard reachable (axe, serious) | Calendar board | Focusable named region |
| Hydration error (React #418) on every calendar load | Day headings formatted by `Intl` differ between Node and Chromium ("Mon 5 Oct" vs "Mon, 5 Oct") | Deterministic Europe/London day labels (`lib/day-label.ts`, unit-tested), also used by Routes |
| WCAG 2.1.2 / 2.4.3: Escape did not close dialogs, Tab left them, focus was not returned | 11 custom `.modal` dialogs (clients, jobs, properties, team, tenants, staff, packs, wording, incidents, data sources, stage gate) | Shared `ModalKeyboard` in the root layout: Escape uses the dialog's own close control, Tab and Shift+Tab stay inside, focus returns to the opener |

### Results after the fixes

- **Responsive.** 360, 390, 768, 1024, 1440 and 1920 px, in light and dark (system preference, reduced motion): no page-level horizontal overflow and no page errors on any of the 180 page loads.
- **axe-core 4.10 (WCAG 2.0/2.1 A and AA, 2.2 AA).** At 390 and 1440 px in both themes: **0 violations** across all 15 pages.
- **Keyboard: 19 of 19 device checks passed.**
  - The first Tab reaches a visible skip link, which moves focus to the content region.
  - The client dialog opens with focus inside. Tab stays inside, Escape closes it and focus returns to "New client".
  - The first 30 tab stops on Overview each show a focus indicator.
  - The phone navigation menu opens with Enter and closes with Escape.
- **200% enlargement.**
  - Browser-zoom equivalent (640 CSS px at 2× density): no page-level horizontal scrolling on any page.
  - 200% root text size at 1280 px: no page-level horizontal scrolling on any page.
- **Offline (390 px).**
  - The service worker is registered, and the device copy is stored in a per-user, per-practice IndexedDB database.
  - With the network off, the survey reopens from the cached shell and device copy. It shows "Offline. 1 change saved on this device."
  - Recording controls stay disabled offline for a user without recording permission.
  - Back online, the queued change is sent to `/api/v1/surveys/:id/sync`. The server refuses it (403 `professional_recording_required`); the change stays on the device and the user is told.
  - "Remove offline copy" clears the pack and outbox.
  - The service worker holds no API responses.

### Not verified, and why

- **Offline recording of findings, end to end.** The local preview owner deliberately has no recording permission, and Clerk is unavailable here. So entering findings offline, then syncing, conflict handling and replay could only be checked through the permission-refusal path above. Server-side replay, conflicts and the removed-content guard are covered by the integration suites (for example the stakeholder journey and migration 0070 tests). A staging run by a surveyor with recording permission is still needed.
- **Assistive technology and real devices.** No screen reader (NVDA, VoiceOver, TalkBack) or physical phone was available. axe checks names, roles and landmarks, not the spoken experience. Those manual checks remain on the [release checklist](release-checklist.md).

## 3. External integrations

### How each integration was checked

- **Network.** The environment's network policy blocks every provider host except Google APIs: SMTP2GO, Stripe, Microsoft Graph, Vercel Blob, Postcodes.io, Planning Data, Nominatim, OSRM and EPC. Each fails at the proxy (connection refused, HTTP 000), and documentation fetches fail the same way. So no live provider call could be made.
- **Contracts.** Instead, each client was compared with the provider's current published contract, found through web search (sources below). Its tests were run, and the deployed Vercel project's configuration was read: variable names only, values never decrypted.

### Results

| Integration | Code vs provider contract | Tests | Deployed configuration (Vercel production) | Live status |
|---|---|---|---|---|
| **Email (SMTP2GO)** | Matches: `POST https://api.smtp2go.com/v3/email/send` with the `X-Smtp2go-Api-Key` header, `sender`/`to`/`subject`/`text_body`/`html_body`, and `data.succeeded`/`data.failed` checks. A 200 response that reports failures is treated as failed, as SMTP2GO documents. Slow sends that hit the 15-second timeout are marked "acceptance unknown" for review rather than resent, which avoids duplicates. | Email queue and delivery unit tests pass | **Not configured**: no `SMTP2GO_API_KEY` or `SMTP2GO_SENDER`. Email is queued but cannot be delivered | Not live-tested (host blocked; no key) |
| **Payments (Stripe)** | Webhook checks: raw body, `constructEvent`, default tolerance, event-ID de-duplication, `payment_status === "paid"`. Idempotency keys on Checkout create, expire and refund. **Gap fixed:** Checkout uses dynamic payment methods, so delayed methods such as Bacs Direct Debit complete Checkout *unpaid*. `checkout.session.async_payment_succeeded` was never handled, so those payments would have stayed pending; it now settles through the same verified path. `async_payment_failed` releases the reservation (audited `client_payment.async_payment_failed`). | 9 signed-webhook integration tests pass, including the new delayed-payment case | **Not configured**: no `STRIPE_*`, `QUOTE_TOKEN_SECRET`, or `CLIENT_PAYMENTS_LAUNCH_APPROVED` | Not live-tested (host blocked; no keys; legal/accounting approval pending) |
| **Calendars (Google, Microsoft)** | Matches. Google: `events/watch` channels with a channel token checked on receipt and expiry parsed. Microsoft: `validationToken` echoed as `text/plain`; `clientState` compared in constant time; `me/events` subscriptions requested for 2.5 days, inside the 4,230-minute limit (longer responses rejected). Reconciliation lists a bounded time window rather than sync tokens, so Google's 410 sync-token expiry does not apply. | Calendar unit and integration suites pass | **Not configured**: no `GOOGLE_*`, `MICROSOFT_*` or `CALENDAR_*` variables | Google endpoints reached unauthenticated: Calendar list and watch return 403 (unregistered caller), userinfo and token return 401. This proves the paths exist; it does not prove a working integration. Microsoft blocked |
| **Storage (Vercel Blob)** | Matches private storage: `put` with `access: "private"`, no random suffix, no overwrite; `get(..., { access: "private" })` through authenticated routes; `del`. **Improved:** Vercel documents that reads may be cached for up to 60 seconds after a change. Removal verification now reads with `useCache: false`, so a deleted original is not reported as still present. Ordinary downloads keep the cache. | New `storage.test.ts` (3); removal storage tests pass | **Configured**: `BLOB_READ_WRITE_TOKEN` in development, preview and production | Not live-tested from here (host blocked) |
| **Routing (OSRM-compatible)** | Matches the OSRM route service: `/route/v1/driving/{lon,lat;...}?overview=full&geometries=geojson`, optional bearer token, and route, leg and geometry validation. Without a provider, routes fall back to labelled straight-line estimates | Fieldwork unit tests pass | **Not configured**: no `ROUTING_PROVIDER_*` | Not live-tested |
| **Property data** | Unchanged and covered by its own register. Postcodes.io and Planning Data were live-verified, and production geocoding and basemap configured, in the 2 October production record. EPC remains `not_configured` | Property-data unit (79) and integration (28) suites pass | **Configured**: `PROPERTY_INTELLIGENCE_ENABLED`, `NOMINATIM_*`, `NEXT_PUBLIC_MAP_*`. No `EPC_*` | Not re-tested from here (hosts blocked) |

### Also found in the deployed configuration

- **Clerk webhooks.** There is no `CLERK_WEBHOOK_SECRET`, so signed Clerk provisioning webhooks (organisation and membership sync) are rejected. Set it before relying on automatic provisioning.
- **Unused variables.** Legacy `FIELDNOTE_UK_*` database variables are present, but the application does not read them.

### Stripe webhook events the endpoint must be subscribed to

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

### Before live activation

For each provider:

1. Add its credentials in Vercel.
2. Run the smoke test from a network that can reach it.
3. Record the outcome here.

The release checklist's approval gates still apply, especially client payments (legal, accounting and client-money approval) and calendars (OAuth app registration and key rotation).

Sources:
- [SMTP2GO authentication](https://developers.smtp2go.com/reference/authentication), [Send an Email](https://developers.smtp2go.com/docs/send-an-email) and [Response codes](https://developers.smtp2go.com/docs/response-codes)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests) and [Fulfil Checkout orders](https://docs.stripe.com/payments/checkout/fulfill-orders)
- [Google Calendar push notifications](https://developers.google.com/workspace/calendar/v3/push)
- [Microsoft Graph subscription resource](https://learn.microsoft.com/graph/api/resources/subscription)
- [Vercel Blob private storage](https://vercel.com/docs/vercel-blob/private-storage) and [consistent reads changelog](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage)
- [OSRM HTTP API](https://project-osrm.org/docs/v5.24.0/api)

## 4. Shared-learning activation requirements

The full requirement list, and the `check:learning-activation` command, are in [`docs/shared-learning/operations.md`](../shared-learning/operations.md#activation-requirements-confirmed-8-october-2026).

### Confirmed

- **Production is off.** Production has the learning schema (migrations 0010 and 0023–0025, applied with 0000–0025 on 2 October). The deployed project has no `SHARED_LEARNING_ENABLED`, `DATABASE_LEARNING_URL` or `LEARNING_LINEAGE_SECRET`, so the programme is off and nothing is copied.
- **Two gates hold until a policy exists.** Activation needs a published policy with a privacy assessment reference and valid release criteria. It also needs three reviewer roles held by different people (one platform role per person).

### Gap found and fixed

The documented "daily sweep" was never scheduled; `runLearningSweep` ran only from the console's manual button. It now runs in the daily cron, and a failure there doesn't break the other daily jobs. This is what makes withdrawal retries and retention-removal erasure happen automatically.

### New readiness check

`pnpm --filter @surveynt/web check:learning-activation` is read-only and checks:

- the migrations, and the separation of the learning, application and owner roles;
- the application role's read-only grant and the lineage secret length;
- the published policy, through the same `programmeStatus` gate the application uses;
- reviewer appointments.

It is integration-tested against a real database (3 tests).

### Still outstanding

These are decisions for people, not code:

- the DPIA and legal review;
- a published policy and release criteria;
- appointing the three reviewers;
- creating the learning login role and granting the application role read access on Neon;
- the secrets;
- L3 pass marks.

The readiness check was not run against production from this environment, which has no production credentials.
