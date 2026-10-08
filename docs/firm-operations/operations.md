# Firm operations release operations

Firm operations are tenant-scoped and protected by the existing organisation roles, RLS and audit trail. Migrations 0026–0031 add settings, versioned service pricing, immutable quote evidence, appointments, calendar connections/conflicts, invoices, client payments, liabilities, external settlements, documents, communication deliveries and retained report-delivery records.

## Release order

1. Apply migrations and run `verify:property-data-security`; it also confirms all firm-operations RLS policies.
2. Seed Clifton with `pnpm --filter @surveynt/db seed:clifton-operations`. The seed is idempotent and keeps both public quotes and client payments disabled.
3. Configure `QUOTE_TOKEN_SECRET` before enabling public quotes. Customer links are opaque, revocable and stored only as hashes.
4. Configure Google and/or Microsoft OAuth credentials plus `CALENDAR_TOKEN_ENCRYPTION_KEY` before showing calendar connection controls as available. Reconciliation still runs on schedule when provider webhooks are delayed or lost.
5. Configure a contracted OSRM-compatible `ROUTING_PROVIDER_URL`, token and attribution before treating route times as available. Straight-line estimates and open-in-maps links remain clearly labelled fallbacks.
6. Configure `STRIPE_CLIENT_PAYMENTS_KEY` and keep `CLIENT_PAYMENTS_LAUNCH_APPROVED=false` until commercial, accounting, VAT, refund and client-money approvals are recorded. Client payments and Surveynt subscriptions use separate keys and metadata routes.
7. Enable organisation feature flags in order: read-only operations, quotes/manual ledger, test-mode payments, calendar sync/routes, then production payments.

## External launch blockers

- Google and Microsoft OAuth application credentials, webhook registrations, token-encryption key and production routing-provider credentials.
- Stripe client-payment restricted key and the legal/accounting launch approval.
- Full HMLR national conversion needs approximately 50 GB of scratch storage.
- EPC credentials, licence acceptance and data-protection handling.

Automated payouts remain deferred. Successful client payments create auditable firm liabilities; an owner/admin may record only an externally completed settlement batch with its reference and evidence.
