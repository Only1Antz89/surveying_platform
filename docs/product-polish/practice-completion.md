# Practice completion features (October 2026)

These features need no new supplier contracts.

## Where to find each feature

| Feature | Where |
| --- | --- |
| Built-in error reporting | Platform → Support → Health |
| CI (lint, typecheck, tests, build, PostGIS integration) | `.github/workflows/ci.yml` |
| Floor plans and room measurements | Survey workspace side panel; frozen into composed reports |
| Terms of engagement signed online | Settings → Operations → Terms of engagement; client case page; job record |
| Branded practice documents (quote, letter, signed terms, practice report) | Quote controls, job record, case page, survey report panel |
| Report review history | Reports → Review history |
| Time, mileage, expenses and profitability | Job record → Time & costs; Reports & insights; Finance |
| Referral sources | CRM suite → Referrals; job record → Client contact |
| Client messages and review requests | CRM suite → Client messages; daily cron; job record |
| Accounting export (Xero, QuickBooks Online) | Finance → Accounting export |
| Data protection requests | Settings → Security & privacy |
| Two-step sign-in policy | Settings → Security & privacy (owner) |
| Feature adoption | Platform → Usage |
| Mobile site capture with offline queue | Fieldwork companion → Capture on site |

## Before production use

- **Database:** apply migration `0082_practice_completion` after `0075`–`0081`. It adds the tables (with tenant RLS and append-only triggers) and new settings columns. Not applied to live data.
- **Text messages:** prepared but disabled until an SMS provider is connected. Skipped sends are logged.
- **Photo storage:** mobile photo upload needs the existing object storage to be configured. Until then photos stay queued on the device.
- **Two-step sign-in:** relies on Clerk's session factor-verification claim, which Clerk marks experimental. Enable MFA in the Clerk instance before a practice turns the policy on.
- **Terms of engagement:** the default demo wording is fictional. Practices should have their own terms checked by their adviser.
- **Accounting import:** uses sales account code 200 and standard UK VAT names. Practices with different charts of accounts should adjust after import, or this can be made a setting.
