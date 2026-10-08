# Platform and client management review

Review date: 6 October 2026.

## Outcome

Platform staff can open the same client register used by a practice through a timed support session. Read sessions permit viewing; ordinary write sessions require tenant-owner approval. Emergency write access remains restricted to super administrators. Requests are bound to the authenticated staff member and the selected tenant, with expiry and revocation enforced by the server.

The unauthenticated local preview now persists customer lifecycle status, client records, contacts, approvals and support sessions instead of returning successful responses without changing data. Each demo practice has its own records. Signed-in demo organisations continue to use Clerk and PostgreSQL.

This is a code sweep and automated verification record, not certification of every function or external service.

## Corrected gaps

| Area | Correction |
| --- | --- |
| Platform support | Added a usable client register and session-scoped client/contact API routes. The APIs verify staff ownership, permission, approval, expiry and revocation before accessing tenant records. |
| Client register | Create, edit and archive now persist in local preview; opening a record retrieves its current version. Stale edits return a conflict instead of overwriting a newer change. Archived clients are excluded from the active register. |
| Contacts | Local create/edit/delete persist and check tenant/client ownership. Missing contacts return 404. Primary contact changes clear the previous primary; PostgreSQL changes lock the parent client to serialize concurrent primary changes. |
| Tenant lifecycle | Local suspension/reactivation persists and affects workspace access. Invalid lifecycle transitions and missing tenants are rejected. Production lifecycle updates lock the organisation and record the reason in the audit trail. |
| Support approvals | Owner approvals/denials change the local session. Production session creation, audit and notification outbox writes are transactional. |
| API access | Suspended and billing-restricted workspace access is checked server-side. Support URLs cannot be used by another operator or a read-only session to mutate records. |
| Errors | Malformed JSON returns validation errors. Client, tenant and approval controls recover from network failures and release their saving state. |
| Demo reset | Membership cloning preserves professional permission grants as well as roles. |
| Clerk provisioning | Failed events can be retried, successful duplicates are idempotent, conflicting event identities are rejected, provisioning writes are transactional, and out-of-order membership/invitation events fail for retry instead of being silently discarded. |
| Provisioning queue | Authenticated deliveries now execute verified provisioning instead of merely echoing the event. |
| Lint | Excluded the bundled third-party fieldwork vendor code from application linting. |

## Using platform management

1. Open `/platform/tenants` and choose the customer account.
2. Request support access, supplying a ticket reference and reason.
3. For ordinary write access, the tenant owner approves the request in `/app/<organisationSlug>/team`.
4. The requesting operator opens the approved session from `/platform/support`.
5. Client and contact changes made there are visible in that practice's client page. Production mutations include staff and support-session attribution in the audit trail.

The local preview links are:

- Clients: `http://localhost:3000/app/demo/clients`
- Platform customer management: `http://localhost:3000/platform/tenants`
- Support queue: `http://localhost:3000/platform/support`

Tenant detail pages include a link to the appropriate local demo client workspace. The preview server must be running and Clerk keys must be absent for this local mode.

Local preview state is stored under the operating system temporary directory, in `surveynt-local-preview/<workspace-hash>/state.json`. It is intended for local review; it is not durable hosted storage. Jobs, properties and other preview sections still use their existing fixtures. Use a signed-in PostgreSQL-backed demo organisation for full workflow validation.

## Provisioning queue delivery contract

`POST /api/queues/provisioning` requires:

- `Authorization: Bearer <QUEUE_CONSUMER_SECRET>`.
- The original Clerk webhook request body, unchanged.
- The original `svix-id`, `svix-timestamp` and `svix-signature` headers.
- A configured `CLERK_WEBHOOK_SECRET`.

Signature verification is performed by the shared Clerk webhook handler. Invalid signatures are rejected. Failed processing returns an error so the delivery can be retried; signature timestamps remain subject to Svix's verification window. A queue wrapping the original event inside another JSON envelope must be updated to deliver the original signed body.

## Verification

- Surveynt: all 27 lint, type-check and unit-test tasks passed across nine packages.
- Surveynt: 402 tests passed. The 22 added regressions cover local tenant/client/contact persistence and isolation, optimistic concurrency, support permissions, real Svix signature verification with mocked database operations, webhook retries and queue execution.
- Surveynt: the production build passed, including Next.js compilation, TypeScript checking and static page generation.
- Clifton site: 75 tests passed and its production build passed. Its pre-existing source changes were not modified by this review.
- `pnpm test:integration`: 144 tests skipped (3 database, 28 property-data, 113 web). No `TEST_DATABASE_URL` or running local PostgreSQL service was available. Skipped tests are not counted as passes.
- Local browser interaction checks were blocked by the browser tool's security policy. Automated route tests are not visual or browser end-to-end evidence.

## Remaining verification

A dedicated test PostgreSQL/PostGIS database is needed to execute the existing tenant-isolation, survey/report, operational, property-intelligence, learning and governance integration tests. Live Clerk, billing, email delivery, storage and other provider integrations also need configured test credentials and end-to-end checks. Offline/device behaviour and browser interactions were not verified in this run.

Changes are local; they have not been pushed or deployed. Deployed URLs will continue using the existing release until these changes are deployed.
