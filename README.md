# Surveynt

Surveynt is a multi-tenant operations platform for UK surveying practices. It connects people, properties and projects in one clear place. This repository contains the new SaaS product; it does not modify the existing Clifton Surveyors application.

Surveynt is the approved product identity. Provider IDs, tenant UUIDs and other
integration identifiers remain brand-neutral so future presentation changes do
not affect customer data or external integrations.

## Workspace

- `apps/web` — Next.js 16 firm portal, platform administration and API routes.
- `packages/domain` — shared roles, access policy and workflow rules.
- `packages/db` — Drizzle schema and PostgreSQL migrations.
- `packages/ui` — reusable Surveynt primitives.
- `packages/config` — shared project conventions.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. With no provider credentials, the app opens a labelled demo workspace using representative surveying data. Copy `.env.example` to `.env.local` and connect Clerk, Neon and Stripe to enable production-backed authentication, storage and billing.

## Quality checks

```bash
pnpm check
```

Database migrations are in `packages/db/migrations`. Production deployments must run migrations with the application database role and admin database role separated.

## Transactional email

Production email is delivered through SMTP2GO's standard email API. Configure
`SMTP2GO_API_KEY` and a verified `SMTP2GO_SENDER`; never expose either to the
browser. The protected daily Vercel cron queues trial-ending notices at seven,
three and one day, then processes the durable database outbox. Delivery attempts
are bounded and retried with backoff. Permanently failed jobs and failed webhook
processing appear in Platform → Incidents.

## Platform administration

Platform access is independent from a firm's Clerk organisation membership. Set
`PLATFORM_SUPER_ADMIN_EMAILS` to the exact verified email addresses that may be
bootstrapped as platform super administrators. When Clerk sends a `user.created`
or `user.updated` webhook for a matching address, Surveynt idempotently creates
or reactivates the `platform_staff` record. Remove the bootstrap variable after
the initial administrator has been created; ongoing staff changes should be made
through the audited platform controls.

Clifton's legacy passwords must not be copied into deployment variables or the
database. Migrate Anthony and Stephen through Clerk invitations or activation
links so Clerk owns password and MFA enrolment. Anthony should be both the
Clifton organisation owner and the initial Surveynt `super_admin`; Stephen is a
Clifton organisation member only unless platform access is granted separately.
