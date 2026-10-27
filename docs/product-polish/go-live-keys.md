# Go-live keys

The backend for payments, email, public quotes and calendar sync is built. Each one switches on when its keys are added to Vercel production. This page lists what to add and where each provider must send its webhooks.

## Check what is missing

The platform settings page (`/platform/settings`) lists every service with its missing variables, any malformed values, and the URLs to register. It never shows secret values.

From a terminal:

```sh
vercel env pull .env.production.local --environment=production
pnpm --filter @surveynt/web check:go-live -- --env-file .env.production.local
rm .env.production.local
```

It exits non-zero until everything is ready.

## What to add

| Service | Variables | Register with the provider |
| --- | --- | --- |
| Sign-in (Clerk) | `CLERK_WEBHOOK_SECRET` (`whsec_…`). The keys are already set. | Webhook `https://<app>/api/webhooks/clerk` for `user.created`, `user.updated`, `organization.created` |
| Subscription billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BASE_PRICE_ID`, `STRIPE_SEAT_PRICE_ID` | Webhook `https://<app>/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded` |
| Client deposits and balances | `STRIPE_CLIENT_PAYMENTS_KEY` (restricted key in the same Stripe account and mode), then `CLIENT_PAYMENTS_LAUNCH_APPROVED=true` once approvals are recorded | Same Stripe webhook |
| Email | `SMTP2GO_API_KEY` (`api-…`), `SMTP2GO_SENDER` | Verify the sender domain (SPF and DKIM) in SMTP2GO |
| Public quotes | `QUOTE_TOKEN_SECRET` (at least 32 random characters: `openssl rand -base64 48`) | Each practice turns on public quotes in its settings |
| Google Calendar | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth redirect `https://<app>/api/v1/calendar/oauth/callback`; push notifications arrive at `/api/webhooks/calendar/google` |
| Microsoft 365 | `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET` | OAuth redirect `https://<app>/api/v1/calendar/oauth/callback`; notifications arrive at `/api/webhooks/calendar/microsoft` |
| Both calendars | `CALENDAR_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), `CALENDAR_WEBHOOK_SECRET` (at least 32 random characters) | |

`APP_URL`, `CRON_SECRET` and `QUEUE_CONSUMER_SECRET` are already set in production.

Use Stripe test-mode keys first (`sk_test_…`, `rk_test_…`) and run one deposit and one balance end to end before switching to live keys. The checker refuses a live billing key combined with a test client-payments key, because the shared webhook verifies one account.

## Client emails sent automatically

Once SMTP2GO is configured, these go out without any practice setup. A practice can reword or switch off each one under Client messages:

- Client portal invitation, when a quote deposit is paid
- Booking confirmation, when a visit is booked
- Payment receipt, for each confirmed deposit or balance payment
- Report ready, when the job moves to Issued

Appointment reminders and review requests stay opt-in. Migration `0085_message_workflow_keys` must be applied before a practice can save its own wording for the three new messages. Until then the default wording is used.

## Proven without keys

`apps/web/test/live-practice-journey.integration.test.ts` runs the whole job flow for a live (non-demo) practice: signed quote link, Stripe Checkout, signed webhooks (including a tampered amount and a replay), booking, role limits on recording and approval, report issue, balance payment, and delivery through SMTP2GO. Stripe and SMTP2GO are simulated at their network edge, so all Surveynt code runs as it would with real keys.
