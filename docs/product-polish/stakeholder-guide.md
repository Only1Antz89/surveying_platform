# Private stakeholder test guide

Prerequisite: the staging migration and authenticated demo provisioning must be complete. The local unauthenticated design preview is not a persistent demo and cannot demonstrate security or saved edits.

## Access

Sign in normally, open the demo practice using the account practice switcher, and confirm the practice is explicitly labelled Demo. Invite the agreed owner/admin and surveyor through the existing Team controls; do not share staff passwords. Owners/admins can operate demo scenarios. Only the owner can reset a generation.

## Connected journey

1. In Customers, inspect the six fictional customer records and their linked properties/jobs. Edit a fictional contact and reload to check persistence.
2. Create a staff quote using an active demo service. Check the immutable price/VAT/deposit breakdown and seven-day expiry; customer statements are not surveyor observations.
3. Open the one-time secure customer link in a separate browser context. It must not grant staff access or disclose other customers.
4. Enter the fictional property address and accept. Try the explicitly labelled declined-payment scenario: it must not create a successful payment or converted job.
5. Run the simulated deposit success. Repeat the submission; there must still be one payment and one converted job.
6. Choose an offered slot, not free-form text. Confirm the appointment appears in the customer view, staff calendar and linked job with an assigned professional.
7. Use staff scheduling to reschedule. Check closures/busy periods and the conflict scenario. Cancelled visits must be labelled clearly; no external calendar may change.
8. Open the job’s existing inspection workspace. Enter fictional observations through the normal questionnaire. Assistance is separate and requires explicit review; do not use the illustrative house as measured evidence.
9. Compose a report draft. Confirm the customer cannot view it. Complete explicit human review/approval and normal issue-stage requirements, then issue the report.
10. Reload the customer portal. It should expose only the issued, approved report content, never draft inspection fields, internal traces or another job’s report.
11. Complete the simulated balance checkout. Verify deposit plus balance invoices reconcile to the accepted quote and the same totals appear in Finance.
12. Exercise a partial refund. Confirm net receipts and outstanding amounts reflect the refund. Revoking/reissuing a link must invalidate the previous token. Expired unconverted quotes must not accept checkout.

## Appearance and account checks

Test System/Light/Dark, reduced motion, increased contrast, comfortable density and larger text. Reload, then use another signed-in device to confirm server preferences. Check Profile/security controls in Clerk, self-declared RICS number, personal hours and route origin. A provider-managed account may not have a password; it should use the provider’s security journey.

At phone/tablet/desktop widths, keyboard through navigation, forms, dialogs and tables. Test 200% enlargement and a screen reader. Report unclear labels, clipping, lost focus, stale success messages, inaccurate totals or any actionable control that does nothing.

## Reset

Owner-only reset requires confirmation, creates a fresh demo generation and archives the previous tenant records/audit history. Old customer links must stop working. Do not run reset in a real practice. Reset recovery and full authenticated browser acceptance remain release checks.

## Safety

All demo people, records and payment outcomes are fictional. Reserved example email addresses receive no external mail. Payments must never contact Stripe; calendars must never call Google/Microsoft; route/intelligence examples must be labelled simulated or unavailable. Never enter real customer information into the stakeholder demo.
