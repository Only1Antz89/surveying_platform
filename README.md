# FIELDNOTE

FIELDNOTE is a multi-tenant operations platform for UK surveying practices. This repository contains the new SaaS product; it does not modify the existing Clifton Surveyors application.

## Workspace

- `apps/web` — Next.js 16 firm portal, platform administration and API routes.
- `packages/domain` — shared roles, access policy and workflow rules.
- `packages/db` — Drizzle schema and PostgreSQL migrations.
- `packages/ui` — reusable FIELDNOTE primitives.
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
