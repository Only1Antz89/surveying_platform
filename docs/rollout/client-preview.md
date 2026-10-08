# Client review demo

Published on 8 October 2026 from commit `bff9e10` to the separate Vercel project `surveynt-client-demo`.

## Shareable links

- Practice administration: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/overview
- Manager workspace: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/manager/overview
- Surveyor workspace: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/surveyor/overview
- Platform tenancy management: https://surveynt-client-demo.vercel.app/platform/tenants

The client can open these links directly. No application email or password is required. The fictional practice owner is Maya Patel; the platform fixture is Surveynt Operator. These are preview identities, not authenticated production accounts.

The sidebar selector exposes all three practice instances. Surveying mode shows Maya's own sample assignments. The platform view is separate and does not follow from the practice workspace switch.

## Preview limits

This project has no production Clerk, database, payment or provider credentials. Scheduled jobs were omitted from the deployment snapshot. Fictional changes use the existing local fixture mechanisms and must not be relied on for durable, private records. Connected AI, live tracking, weather, traffic, payments and secure real client case links require their authenticated configuration.

The existing production application was not promoted or migrated. The redesign is pushed on `codex/surveynt-completion-updates` for review in https://github.com/Only1Antz89/surveying_platform/pull/4. The normal Git integration also built an authenticated preview for that branch.

The deployed administration page, manager dashboard, personal fieldwork and platform tenant register were checked in the Codex browser without signing in. The practice switch was exercised in both directions, with the same fictional actor.
