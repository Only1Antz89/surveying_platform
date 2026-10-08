# Surveynt product polish — implementation and release record

Status: **in progress; not a production-release sign-off**. This record describes the local implementation as at 3 October 2026. The new migration has not been applied to production, and the new private stakeholder practice has not yet been provisioned there. Existing hosting, Clerk authentication and the application remain in place.

## Implemented locally

- Six primary destinations with contextual views, preserved routes, Clients redirect, unified Reports library, working search and audited-event notifications.
- Blue/slate/white design tokens, three-node favicon, labelled architectural artwork, System/Light/Dark themes, immediate local appearance mirror and authenticated persistence.
- Personal professional details, self-declared RICS number, membership hours/timezone/route origin, accessibility and notifications preferences, and Clerk-managed identity/security controls.
- Persistent tenant-native fictional seed: six customers, eight properties, twelve jobs, linked quotes, appointments, invoices, simulated payments/refund, documents, draft reports and a calendar conflict. Seed retries do not duplicate records.
- Server-enforced demo adapters for payments, email, calendars, routing, identity and property intelligence. No live provider calls in the tested customer journey.
- Scoped rotating customer links; address acceptance, declined/successful simulated checkout, exactly-once job conversion, actual bookable slots, issued-report access and balance checkout.
- Transactional appointment claims shared by staff and customer routes, eligible member assignment, closures, personal hours, travel buffers and optimistic rescheduling.
- Per-invoice aggregation over complete payment history, refund-aware receipts, invoice detail/action endpoints, document retention/legal-hold controls and retained originals on archive.
- Staff quote contact updates, optimistic version checks, one-time fresh links and delivery history; changing the recipient email revokes the earlier link without altering accepted pricing.
- Idempotent draft invoice creation with minor-unit line items and VAT rounding; reviewed external settlement selection with exact-amount and concurrent-submission checks. Draft/void invoices are not collectible.
- Date-filtered, server-aggregated Insights with separate currencies, workload, pipeline, service mix, actual completion events and streamed summary CSV.
- Retained document replacement and editable access classification, with administrator-only restricted files and assigned-surveyor job files. Replacement cannot erase a legal-held original.
- Personal day-off controls, inherited firm hours, appointment form prefilling, role-filtered availability/conflicts and eligible-surveyor assignment choices.
- Readiness details include actual reference coverage/version/sync metadata and calendar connection health, without returning secrets. EPC execution requires explicit licence and data-protection approval.
- Checkout retry safety: open sessions are reused, completed sessions remain pending verification, and expired sessions receive a stable new attempt key. Live-payment approval gates remain enforced.
- A reusable architectural artwork library for detached houses, semi-detached houses, bungalows, apartments, commercial premises and rural land, alongside the original terrace. Property Overview selects from the recorded type, uses a labelled generic fallback for unknown types, and never treats illustrations as survey or boundary evidence.

The Sites design workflow informed the existing application design; no separate website or hosting migration was created. The architectural concept is adapted to real operational records rather than illustrative metric counts.

## Verification already run

- Repository lint, typecheck and unit suites passed during this implementation.
- Targeted polish API integration suite: 10 tests passed against disposable local PostGIS, including permissions, document replacement/classification, invoice lifecycle, concurrent refunds/settlements, actual Stripe signature verification, replay and out-of-order refunds.
- Latest web unit suite: 52 tests passed, including London DST day lengths, personal-hours inheritance, capability-secret exclusion, Checkout retry safety, artwork selection and physical image asset validation. Web lint/typecheck and the production build also passed after artwork integration.
- Fresh repository lint/typecheck/unit/build passed on 3 October, including the latest account and narrow-screen changes.
- Latest complete web integration run: 16 files, 87 tests passed. The earlier sweep found EPC-fixture approval omissions in two older suites; their test-only acceptance flags were corrected without weakening production gates or assertions.
- Database tenant-isolation integration: 3 tests passed. Property-data integration: 5 files, 28 tests passed, covering spatial boundaries, importer/runtime role restrictions, atomic activation/rollback and source operations.
- Browser overview inspected separately at 360, 390, 768, 1024, 1440 and 1920 pixels without document-level horizontal overflow. Light/dark, larger text and high contrast were exercised. Mobile drawer Escape/focus return and account-menu Escape were checked.
- Account availability/day-off selection was verified in the local browser. A 319-pixel account preview initially clipped the header; it now fits at document/header width 319 pixels with all primary controls visible. Profile/security no longer shows an unrelated preferences-save button.
- Property Overview was inspected in light and dark themes at phone and desktop widths. The detached illustration loaded correctly; the property identity panel now fits at 319 pixels, and the light-theme page fits at 390 pixels without document overflow. Arrow-key/Home tab navigation was checked. Property-only layout changes leave RICS form styling untouched.
- Existing survey/report integration tests and explicit customer-report approval journey passed. No questionnaire wording/order/rating palette or report-template changes were made.

These checks are not a WCAG certification, a full six-width audit of every screen, or an authenticated production smoke test.

GitHub main was checked read-only on 3 October and remains `68d406e811384c159a559d31d55068e36330eff0`, matching the local implementation base. Current polish changes are not committed/published and no production migration or deployment was performed.

## Native work still required before final handover

The list below is the historical inventory. Current completion work and newer verification are tracked in [the completion goal](completion-goal.md); consult that record before treating an item as still missing.

1. Complete manual verified-payment and immutable credit-adjustment workflows; add signed client-Checkout/subscription-routing regression coverage beyond the refund-event cases.
2. Complete streamed invoice/payment/reconciliation exports and authenticated UI checks of Insights date filters and totals.
3. Finish document archive recovery/retention operations and upload-time access classification/job selection. Existing replacement and classification controls require authenticated browser checks.
4. Finish configurable surcharge/recommendation-rule, email-template and notification-delivery settings. Verify import-capacity report metadata is consistently surfaced in readiness.
5. Complete calendar conflict resolution alternatives and job-state handling when the final appointment is cancelled; verify OAuth refresh/key-rotation/webhook-loss recovery with configured test providers.
6. Finish global-profile audit handling outside an active practice and validate personal settings across devices. Account saves now update only the selected section, and cannot overwrite stored settings before initial loading succeeds.
7. Prepare a usable fictional inspection fixture through an explicit demo-only review action; never seed a professional approval or disclose draft reports. Current draft examples deliberately require a real signed-in reviewer.
8. Complete authenticated browser journeys, screen-reader/keyboard checks, 200% enlargement, all-screen responsive states, tenant-role/token tests and final migration/runtime-role validation.
9. Apply the additive migration to staging, provision the private demo, run staging smoke tests, publish the verified commit and perform the controlled demo-first cutover. No Clifton-wide rollout until stakeholder acceptance.

## Links and access

Local design preview: `http://localhost:3003/app/clifton-surveyors/overview` when the development server is running. It is labelled non-persistent and is not the stakeholder demo.

Authenticated demo entry after provisioning: `/app/<demo-slug>/demo`. The owner launch panel generates a revocable featured-customer link. Do not commit tokens, invitation links, credentials or personal stakeholder addresses to this repository. Stakeholders use their own Clerk accounts and normal organisation memberships.

See [stakeholder guide](stakeholder-guide.md), [activation/release checklist](release-checklist.md) and [artwork catalogue and prompts](artwork.md).
