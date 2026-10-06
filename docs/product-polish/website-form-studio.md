# Website form studio and customer embed

## Entry points

- Owners/admins: Settings → Website form (`/app/<practice>/settings/website-form`). Managers and other roles cannot enter the studio or its configuration APIs.
- Public iframe: `/embed/<practice>`. Standalone fallback: `/quote/start/<practice>`.
- Management follow-up: Customers → Website enquiries. Shows the latest 100 bespoke enquiries with new/contacted/closed status and customer statements.

The studio uses the same customer renderer in a same-origin iframe with a real, adjustable viewport. No scaling is applied; large viewports scroll horizontally. The preview badge, simulated completion reference and disabled portal continuation are intentional differences. Preview requests never enter the submission API. Anonymous local preview can edit appearance but cannot save or publish.

## Owner/admin walkthrough

1. Enter the practice display name, HTTPS logo URL, copy, contact details and privacy notice. Select a contrast-safe blue/slate accent and spacing preset.
2. Select residential/commercial/land paths and optional questions. At least one path remains enabled. Required identity/address fields and disclosures cannot be removed. Phone stays in the contact step; alterations/concerns can be reordered.
3. Select catalogue services, or leave the selection empty to include all active services. Prices remain managed in Operations. Automatic Clifton recommendation rules run only for explicitly configured catalogues; uncertain/unsupported cases require bespoke review.
4. Test the live preview at phone/tablet/desktop/custom widths. Change a heading and confirm it updates without saving. Exercise current readiness, simulated quoting, enquiry-only and unavailable states. Use fictional example.test contacts.
5. Save draft: no public change. Publish: validates privacy/contact/origin configuration, creates an immutable version and atomically updates the active pointer. Concurrent edits receive a conflict instead of overwriting. Restore republishes a previous configuration as a new audited version; unsaved edits must first be saved or discarded.
6. Add exact website origins, including www/non-www variants separately. Copy the iframe and optional resize helper into the website's HTML/embed block. Set parentOrigin to the origin of that particular host page. Restrictive website builders can use the iframe with fixed height or the standalone link.

## Customer journey

Property → details → contact → review → quote or bespoke enquiry. Configured prices/VAT/surcharges/deposit/validity are shown for supported services; commercial/land/unknown-age/other cases require staff review. Quote success returns a scoped secure portal link opened deliberately in a new tab. Acceptance is based on quote status, not merely an existing address. Payment, availability and issued-report permissions retain existing gates.

Structured address and reported property type are retained when a paid quote becomes native client/property/job records. Collected concerns/type/alterations appear as draft customer questionnaire answers only when no later draft/submission exists. Approximate age bands do not become invented build years. Quote snapshots and survey findings are not overwritten.

## Interfaces and safeguards

- `GET/PATCH /api/v1/operations/website-form`: own-tenant configuration; PATCH actions save/publish/restore use an optimistic revision.
- `GET /api/v1/public/website-form/<practice>`: published configuration and current available catalogue only; no secrets or embedding-domain list.
- `POST /api/v1/public/website-form/submissions`: bounded, version-pinned, validated request with UUID requestId, structured address/answers and privacy acknowledgement.
- `GET/PATCH /api/v1/operations/website-enquiries`: management-filtered register and audited status updates.
- Authenticated preview route: `/website-form-preview/<practice>`. Exact parent origin and iframe source are checked before applying preview messages. Resize messages contain only height, never answers/tokens.

Drafts, immutable versions, enquiries and rate windows are tenant-RLS protected. Composite foreign keys reject foreign-tenant version pointers. Preview-only APIs reject persistent changes. Repeated request IDs cannot create both an enquiry and a quote. Form disablement is rechecked transactionally; a previously loaded form cannot bypass it. Staff and customer-token pages deny framing; embeds allow only published exact origins, failing closed on database errors.

Public capture does not require Clerk or third-party cookies. Contact drafts remain in memory until final submission. No automatic external email is sent by this form; staff follow-up and existing secure portal delivery workflows remain available.

Rate limits default to 100 submissions per practice per 10 minutes. Set TRUST_PROXY_IP=true only behind infrastructure that overwrites x-forwarded-for with trusted client addresses; then the limit is 10 per hashed client address per practice per 10 minutes. Never trust arbitrary caller-supplied forwarding headers. Operators should remove expired rate windows during routine retention maintenance.

## Controlled activation and rollback

Migration 0040_website_forms is additive and has only been exercised on disposable local databases. Production migration/deployment needs separate approval. Apply via the existing migration workflow and ensure the application role has the same tenant-table grants for all four new tables. Published versions reject update/delete even for application roles.

Before enabling the new standalone journey for an existing practice, configure/publish its form and verify contact/privacy settings, approved domains, catalogue and enquiry readiness. The old public quote API remains compatible; the standalone UI now requires a published form. Secure instant quotes still require QUOTE_TOKEN_SECRET and the existing publicQuotesEnabled setting. Payments/calendar/provider approvals are unchanged.

Rollback means republishing a known-good configuration or publishing enabled=false. Do not drop tables or delete publications/customer evidence. Reverting application code does not require destructive migration rollback.

## Verification ledger

Automated checks cover configuration validation, colour/URL/origin restrictions, supported/bespoke decisions, integer pricing, publication separation, concurrent revision checks, immutable rollback history, retry safety, RLS, role/API permissions, bounded/malformed requests and framing headers. Existing questionnaire and stakeholder journey regressions also run against disposable PostgreSQL/PostGIS.

Browser checks exercise live heading updates, real 390px preview, complete fictional quote preview, disabled secure continuation, unavailable state and 390/1440px studio layouts. The local anonymous preview is not a certification of authenticated Clerk publishing, production payment/booking, screen-reader accessibility or a separately hosted live website. Those remain release smoke checks after authorised staging configuration.
