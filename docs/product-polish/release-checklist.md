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
- Back up active reference metadata and verify the existing Historic England legacy bridge, source registry, canonical `property_intelligence` queue and `/properties/:id/map` endpoint remain intact.

## Staging and demo-first cutover

- Use staging-only administrative credentials with the existing `@surveynt/db` migration command. Do not point local tests at production.
- Validate migration checksums, runtime-role grants and per-user settings ownership.
- Deploy the verified application to staging. Sign in as an existing owner, provision the private demo and add the agreed Clerk members. Do not provision public credentials or fake staff identities.
- Run every scenario in the stakeholder guide from both staff and customer contexts, including reloads, concurrent claims, refunds, revoked links and human report approval.
- Record results and screenshots for all requested widths/themes plus keyboard, screen reader and enlargement. Compare with the approved concept; explain intentional deviations.
- Publish the exact tested commit and deployment identifier. Record the additive production migration separately and verify source/dataset metadata before and after it.
- Enable `product_polish` for the demo first. Existing real practices retain the legacy navigation until their flag is enabled. Shared CSS/account/API changes still require normal regression review; the navigation flag alone is not complete rollback isolation.
- Enable Clifton only after stakeholder acceptance and explicit release control. Keep live payments/quotes/providers disabled until their own approval/configuration checks pass.

## Rollback

Disable the organisation’s `product_polish` entitlement to restore legacy navigation. If needed, redeploy the previously verified application build. Do not drop the additive profile tables or erase demo generations/audit history. Preserve new writes for recovery, and assess backward-compatible application behaviour before redeployment. Dataset rollback uses the existing versioned reference activation/rollback operations; never restore by duplicating the national Historic England geometry on a capacity-limited database.

Production migration, deployment, private demo provisioning and final stakeholder acceptance have **not yet been completed for this polish implementation**.
