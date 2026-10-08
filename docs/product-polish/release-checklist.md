# Activation and controlled release checklist

This is an operator checklist, not authorisation to bypass an integration gate. Keep secrets in the approved secret manager, never in documentation, screenshots or Git.

## External capabilities

| Capability | Required before live activation | Always-visible caveat |
|---|---|---|
| HMLR | Approximately 50 GB scratch storage; checksum/licence/CRS validation; staging capacity/index/latency/cost report; explicit atomic activation | Indicative freehold extents, not definitive title boundaries |
| EPC | Credentials, licence acceptance, data-protection approval and retention handling | Not checked, no record found and provider failure are distinct |
| Public quotes | Secure `QUOTE_TOKEN_SECRET`, firm enablement, verified organisation/domain resolution | Scoped/revocable access; customer answers remain unverified |
| Client payments | Separate restricted Stripe client-payment key, signed webhook configuration, legal/accounting/VAT/client-money and refund-policy approval, firm enablement | Redirect is pending until verified; no automated firm payouts |
| Calendars | Google/Microsoft OAuth apps, redirect/webhook registrations, encryption keys/rotation, reconciliation worker | Busy periods and conflicts; external changes never silently override invalid availability |
| Routes/maps | Production routing endpoint/credentials/attribution and map style/attribution | Postcode locations and straight-line distances are approximate, not drive times |

No external dependency blocks isolated demo adapters. Demo adapters must not be used to claim live coverage or production approval.

## Before staging

- Review [survey-first access](survey-first-access.md), migrate Manager and explicit permission columns additively, and complete its authorization/RICS/offline release blockers. Provision Stephen as Owner with both explicit professional grants false; do not mistake the local preview for an authenticated stakeholder tenant.

- Finish the native gaps listed in the product-polish inventory.
- Compare current GitHub main with local changes and review any Claude overlap. Preserve unrelated changes; do not force-push.
- Rerun root lint/typecheck/unit/build, web integration and database/property-data integration suites with a test database.
- Review generated migration `0032_stormy_boomerang.sql`, including FORCE RLS and user-owned mutation policies. Test application-role access, guessed IDs and unauthorised mutation, not just administrator connections.
- Reconcile the staging migration ledger against `packages/db/migrations/generated/meta/_journal.json`, which currently ends at `0074_questionnaire_answer_disposition`. Do not apply only migration 0032 or assume disposable-database installation proves hosted installation. Record every unapplied journal entry and its checksum before using `pnpm --filter @surveynt/db db:migrate` with staging credentials.
- Review the one-year policy (`survey-file-1-year-v2`) and migrations 0055–0074 with the practice, and the open schedule decisions in [retained-content-audit.md](retained-content-audit.md), before enabling original removal. Verify current manager membership, policy approval, complaint/claim/legal holds, manifest-only document holds, immutable history and denied content restoration using the application role. Expiry means manager review; it does not authorise deletion.
- Back up active reference metadata and verify the existing Historic England legacy bridge, source registry, canonical `property_intelligence` queue and `/properties/:id/map` endpoint remain intact.

## Staging and demo-first cutover

- Use staging-only administrative credentials with the existing `@surveynt/db` migration command. Do not point local tests at production.
- Validate migration checksums, runtime-role grants and per-user settings ownership.
- Capture the exact application commit, staging deployment identifier, migration ledger and database backup identifier together. Exercise the previous application build against the migrated staging schema before recording rollback readiness; preserving additive tables alone is insufficient proof.
- Deploy the verified application to staging. Sign in as an existing owner, provision the private demo and add the agreed Clerk members. Do not provision public credentials or fake staff identities.
- Run every scenario in the stakeholder guide from both staff and customer contexts, including reloads, concurrent claims, refunds, revoked links and human report approval.
- Verify platform management changes persist in the demo clients page after reload and from a second signed-in session, with tenant/role restrictions enforced. Local preview and PostgreSQL-path equivalents pass ([acceptance results](acceptance-results.md#1-platform-management-persists-into-demo-client-accounts)); the staging run must use real Clerk users. Confirm a removed-content marker cannot be restored by offline sync. Use disposable staging originals for retention execution and lost-response recovery; do not delete real practice files as an acceptance fixture.
- Keep frequent calendar processing paused pending the user's Vercel Pro upgrade. Verify the retained daily schedule separately; a successful deployment does not prove delivery or provider reconciliation.
- Record results and screenshots for all requested widths/themes plus keyboard, screen reader and enlargement. Automated local width/theme, axe, keyboard, enlargement and offline results are in [acceptance results](acceptance-results.md#2-mobile-accessibility-and-offline); screen-reader and physical-device checks remain manual. Compare with the approved concept; explain intentional deviations.
- Publish the exact tested commit and deployment identifier. Record the additive production migration separately and verify source/dataset metadata before and after it.
- Enable `product_polish` for the demo first. Existing real practices retain the legacy navigation until their flag is enabled. Shared CSS/account/API changes still require normal regression review; the navigation flag alone is not complete rollback isolation.
- Enable Clifton only after stakeholder acceptance and explicit release control. Keep live payments/quotes/providers disabled until their own approval/configuration checks pass.

## Rollback

Disable the organisation’s `product_polish` entitlement to restore legacy navigation. If needed, redeploy the previously verified application build. Do not drop the additive profile tables or erase demo generations/audit history. Preserve new writes for recovery, and assess backward-compatible application behaviour before redeployment. Dataset rollback uses the existing versioned reference activation/rollback operations; never restore by duplicating the national Historic England geometry on a capacity-limited database.

Production migration, deployment, private demo provisioning and final stakeholder acceptance have **not yet been completed for this polish implementation**.
