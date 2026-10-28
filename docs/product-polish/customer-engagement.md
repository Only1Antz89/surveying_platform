# Customer engagement and lifecycle

`/platform/onboarding` is now the **Engagement & lifecycle** workspace under Customers. Super administrators, support and billing staff can read and manage it. Customer access, subscription changes and audited support sessions retain their existing workflows.

## What operators can do

- Review current setup, subscription handoff, trial, subscription, billing-attention and offboarding states.
- Search by firm or owner, filter lifecycle and attention signals, exclude demo accounts by default, and export matching customers/prospects with their follow-ups.
- Inspect actual completed/incomplete setup steps, last recorded member activity, recorded checkout creation and trial deadlines.
- Assign onboarding, sales, retention or offboarding follow-ups to active customer-facing platform staff with London due dates, notes and explicit outcomes. Tasks and outcomes are append-only audit events; no customer messages are sent.
- Follow up with verified users who reached the practice form but have no active workspace membership. Staff and pending staff invitees are excluded. A visit can still be in progress and does not imply abandonment or marketing consent.

## Measurement and definitions

- Practice-form visits: authenticated, verified primary-email identity resolved by the server. Recorded at most once per person per Europe/London calendar day. No browser-supplied user identity, page paths or form contents are accepted.
- Workspace visits: server-resolved active membership; at most once per member/account per London day. Internal platform staff visits are excluded. Existing member-attributed audit actions also contribute to recorded activity.
- Checkout created: recorded only after Stripe returns a checkout session. It is an attempt, not a successful subscription. Stripe synchronisation remains authoritative for trial, payment, cancellation and subscription states.
- Stalled setup: at least 3 elapsed days without recorded member activity (account creation is the fallback). Inactive: at least 14 days during trial or subscription. Trial deadline: recorded expiry within 7 days, including overdue trial records awaiting synchronisation.
- Subscription handoff readiness requires accepted access and completed practice details. Later adoption tasks such as first teammate/report templates do not block this stage. All actual setup steps remain visible separately.
- Stage counts are current snapshots. They are not historical conversion rates, revenue or an ordered funnel. Authentication failures, anonymous marketing visitors, abandoned Clerk registrations and pre-release practice-form/checkout visits are unavailable. Measurement starts when this change is deployed; no history is fabricated.

## Persistence and protection

No new table or migration is required. Internal follow-ups are platform-only audit events (`organisation_id = null`, authenticated `platform_staff_id`, customer/prospect target in metadata). Customer RLS cannot read or insert them. Reads/completion also reject tenant-authored lookalikes. Assignment validates an active support, billing or super-admin staff member. Advisory transaction locks deduplicate concurrent create retries and prevent duplicate completion. A reused request ID with different contents fails explicitly.

Completing offboarding coordination does not cancel billing, revoke access, export customer data or delete records. Operators must use the existing authorised workflows and record the result. Prospect follow-ups remain in internal history after the prospect joins a customer.

Visit and checkout measurements are best effort and do not block setup if analytics persistence fails. The lifecycle loader uses SQL aggregates from existing records. The preview shows labelled demo accounts and disables persisted follow-up controls.

## Validation

Unit coverage: lifecycle precedence, subscription handoff versus adoption, stalled/inactive/deadline boundaries, London dates, valid due dates and role restrictions.

Database coverage: verified visit deduplication, prospective customer eligibility, concurrent task retries/completion, inactive assignees, API authorisation, internal-note isolation under customer RLS, rejection of tenant-authored events, member activity, demo exclusion, filtered CSV and reconciliation after workspace membership.

Browser flow: open engagement, search/filter the queue, preserve URL filters, inspect desktop and narrow layouts and verify loading/error-free rendering. Follow-up persistence is exercised against a disposable PostgreSQL/PostGIS database; no real prospects are contacted during QA.
