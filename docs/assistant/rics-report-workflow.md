# Surveyant Home Survey workflow

Surveyant supplies RICS output templates centrally; companies do not upload their own documents. Each company owns its licensed-service configuration and RICS licensing entitlement. Admin > Settings records each enabled recording template, company licence reference, optional expiry, and exact service-name mappings. New companies have a report-templates onboarding step. Saving completes that step; an empty selection records that no Home Survey templates are enabled.

The service selected through a booking or embed maps to a recording template when the survey is started. A service name must map to one template; otherwise the survey starter chooses manually. Both the template key and version are pinned to the survey. Configuration changes never rewrite existing records. Expired or disabled configured Home Survey templates cannot start new surveys. The generated database migration `0080_brown_goblin_queen.sql` must be applied before enabling the live settings UI.

## Capture and provenance

Section form and Guided questionnaire edit the same versioned field paths. The Level 3 demo currently contains 223 questions. Inspection status, limitations, observations, evidence links, explicit unanswered states, field validation and professional permissions remain part of the record. Suggestions are accepted individually; professional assessments require explicit confirmation. Accepted source values appear blue, manual answers and edited proposals black. Job references and linked addresses are reviewable suggestions; scheduled appointments never become an assumed actual Home Survey inspection date. Reusable practitioner/firm identity is sourced with freshness checks. Membership numbers are self-declared, not verified by this UI.

Demo recording is device-only. Pending answers persist in the scoped offline store across reloads, but are never discarded after a stateless demo API response. Live recording still uses tenant-scoped synchronization, conflict checks and server-enforced professional permissions. The demo cannot sign off reports. Removing its offline copy discards its local answers.

## Output status

The current recorder templates are explicitly firm drafts, not licensed RICS publications. The downloadable HTML is a printable review copy assembled from recorded answers and observations. It uses black body text and purple headings (#4d2d69), and excludes internal provenance details. Print / Save PDF is available in the downloaded document. This export always says **DRAFT — NOT FOR ISSUE**; no claim of formal RICS compliance is made.

Verified official samples use purple section headings and black body text:

- [RICS Home Survey Level 2 sample](https://www.rics.org/content/dam/ricsglobal/documents/standards/rhs_level_two.pdf)
- [RICS Home Survey Level 3 sample](https://www.rics.org/content/dam/ricsglobal/documents/standards/Sample-Home-Survey-Level-3-Report.pdf)
- [RICS Home Survey licences](https://www.rics.org/profession-standards/home-surveys-licences)

## Required before formal output

A licence-reference entry is not a licensed document or proof of independent verification. RICS confirms branded reports require ProForms or an authorised template provider. Surveyant still needs platform distribution authorisation and authorised, versioned output assets for each supported licensed template; complete field and photograph mapping; official terms, descriptions of service and required appendices; typography/pagination checks; and professional approval against the corresponding standard and service level. The current admin selection stores recording-template entitlement; it does not upload or reproduce licensed RICS documents. Built-in firm drafts remain blocked from report approval by the existing server template-review gate.

Licences are configured in Admin during company setup. Embedded service mappings resolve when the resulting job’s survey starts; this change does not introduce automatic report creation, modify booking publication, or implement a new embedded booking checkout.

## Validation

Browser plugin not available; regular Playwright was used against the isolated webpack preview on port 3001. Verified source acceptance, blue/black provenance, editing, cross-view navigation, reload persistence, all eleven Level 3 sections and 223 fields, draft composition/download, and Admin device-only preview configuration. Live database migrations and licensed-document output have not been exercised against a provisioned company.

## Central PDF provision

`SURVEYNT_RICS_TEMPLATE_DIRECTORY` points to a private deployment directory containing `catalogue.json` and centrally provisioned authorised PDFs. This is configured by Surveyant operations, not a company admin. A catalogue entry pins `templateKey`, `templateVersion`, `pdfFile` (a basename), `sha256`, `supplier`, `distributionAuthorisationReference`, `professionallyReviewedBy`, `reviewedOn`, and `definition`. The definition has version 1, bindings of source to PDF target, and appendPhotographs. Direct field mappings must cover every report field; composed section mappings alone cannot prove that answers are included. Original pages and form fields are retained. The loader validates the checksum, PDF structure, destination fields, bounds and coverage. No official sample is shipped as a licensed production asset.

The authenticated `/api/v1/report-templates/catalogue` endpoint exposes availability only. `/api/v1/surveys/[id]/report/pdf` exports a **watermarked draft review copy** from the latest unchanged report, requires the company's active licence configuration for the pinned version, and includes linked photographs. It rejects unavailable photographs, unsupported images and overflowing text. No truncation or automatic shrinking is used. Text is black; the original supplied document retains its layout and colours. Interactive PDF canonical values and widget appearances are updated together; forms are not flattened. Unsupported Helvetica characters currently fail explicitly and require a compatible central font/layout implementation.

This capability does not enable formal issue: the existing professional template review gate still applies. There are no authorised output PDFs or distribution references in this checkout. Producing formally usable RICS reports remains incomplete until those assets, full template review and final output acceptance checks are supplied. Company licence entry is a declaration, not verified membership or entitlement.

## Mapping availability

Street maps use the attributed OpenFreeMap style by default in every environment, including blank environment-variable values. A contracted/self-hosted style can override it. The preview worker file has been restored by the normal copy script. Satellite and terrain require separately configured, attributed imagery/elevation providers. Clicking either unconfigured option now explains the missing provider; it does not present ordinary street tiles as satellite or elevation. These providers remain unconfigured in the current preview.

Final validation: 485 web tests passed, including central catalogue and PDF output rejection checks. 76 assistant tests, web/assistant/database type checks and lint passed. Database integration suites skipped because TEST_DATABASE_URL is unset. Playwright confirmed licence settings persistence, blue source-prefill text, mobile width and no JavaScript page errors. Synthetic PDF validation checked two retained pages, the canonical field/widget relationship, black rendered answers, original purple heading and preserved appendix. Live migration and RICS acceptance checks remain pending. Street maps and role-specific navigation were also verified in admin, manager and surveyor views. The user confirmed that a RICS provider arrangement still needs arranging; see rics-provider-onboarding.md.

## Media and retention follow-up

MP4/WebM recording and private byte-range playback, a company archive extension, day countdown and one-year customer report expiry were added. Linked video now explicitly prevents the review PDF export until a customer supplement is available. See [RICS media delivery review](rics-media-delivery-review.md) for researched requirements, exact current capabilities and outstanding publication/authentication work. Migration 0081 is required for video and archive dates.
