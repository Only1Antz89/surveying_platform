# Surveynt customer-management console

The platform console separates customers, internal platform users, reporting and integrations. Platform sign-in remains independent of organisation membership; customer workspaces retain their existing membership and timed-support requirements.

## Behaviour

- Customers: full-width searchable/sortable register, URL filters, pagination, escaped CSV export, current account-health summaries and detail tabs. Actual onboarding steps determine completion; user-attributed audit events determine recorded activity.
- Manual provisioning and self-onboarding share the same service. Manual creation never adds the platform operator as a customer member. A durable request key and Clerk metadata support recovery; ambiguous remote creates fail closed rather than issuing duplicate creates. Owner acceptance is synchronously reconciled against verified identity and actual Clerk membership, without relying on webhook timing.
- Platform users: existing verified-account grants, invitations, resend/revoke and role/status filters. Acceptance requires the matching verified primary email and provider-confirmed accepted invitation. Role changes and invitation acceptance serialize with a common database lock, with self-lockout and final-administrator protections.
- Reports: business and operational views, London calendar-date bounds, demo exclusion by default and consistent CSV exports. Business reporting requires super-admin or billing access. Current snapshots and date-range activity are labelled separately; unavailable revenue and historical conversion metrics are not inferred.
- Integrations: readiness and platform connection configuration moved out of customer management and Settings. Configuration presence is explicitly distinct from a verified connection.

## Database and account sync

Migration `0086_platform_customer_console` adds two platform-only tables with row-level security: `platform_staff_invitations` and `customer_provisioning`. No tenant access policy is added to either table.

On 28 October 2026, the production ledger matched through 0085 before migration and all 87 migrations matched after migration, including 0086. No existing migration hash or timestamp differed. Database size after migration was 837,517,312 bytes.

The missing Clerk webhook application was initialised. Its production endpoint is `https://surveying-platform-taupe.vercel.app/api/webhooks/clerk`, subscribed only to handled user, organisation, membership and organisation-invitation events. Its signing secret is stored as a production-only Vercel Secret, never in source. Delivery remains disabled until the application release is verified, then must be enabled and smoke-tested.

Invitation URLs use the server-controlled canonical application origin. Production configuration has `APP_URL=https://surveying-platform-taupe.vercel.app`.

## Validation

- 658 web unit tests pass.
- 15 targeted PostgreSQL/PostGIS integration tests pass, including existing timed-support persistence.
- Coverage includes interrupted remote creation, manual/self onboarding, synchronous owner acceptance, staff acceptance/revocation/expiry, verified-account grants, customer edits, RLS, concurrent admin revocations, report totals, London DST boundaries, demo exclusion and CSV consistency.
- Web TypeScript, full web lint and the production build are checked before release.
- In-app browser checks cover customer search, account tabs, staff dialog keyboard dismissal, desktop and narrow layouts, dark/light logo contrast and console errors. A table hydration warning and clipped mobile values found during validation were fixed.

No real customer accounts or staff invitations were created during validation. Provider interactions in database tests are mocked.
