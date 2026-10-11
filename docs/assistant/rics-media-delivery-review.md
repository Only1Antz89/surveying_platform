# RICS alignment and customer media delivery review

Reviewed 11 October 2026. This is an engineering assessment, not RICS approval of Surveyant.

## Authoritative requirements

The [RICS September 2026 update](https://www.rics.org/news-insights/home-survey-standard-2nd-edition-september-2026-update) targets publication of the second edition in Q1 2027. Continue against the first edition; do not label the consultation draft as effective.

The [Home Survey Standard](https://www.rics.org/content/dam/ricsglobal/documents/standards/home_survey_standard_nov_2020.pdf), sections 4 and Appendix A, requires level-appropriate, property-specific reporting. Level 1 excludes repair advice; Level 2 includes repairs and maintenance; Level 3 adds likely causes, remedial work, consequences, priorities and timescales. Inspection limitations must be meaningful. Further-investigation advice identifies why, when and the appropriate professional. EPC treatment varies by level. Record post-report discussions and retain a complete secure file. Section 4.13 describes retention for up to 15 years according to applicable legislation and risk guidance. One year cannot be advertised as universally compliant. Section 4.12 places software suitability responsibilities on practitioners and regulated firms.

[RICS licensing guidance](https://www.rics.org/profession-standards/home-surveys-licences) requires company entitlement and ProForms or a permitted supplier for branded templates. Unbranded bespoke reports still need to comply with the standard. The user has confirmed Surveyant's supplier/provider arrangement is not yet secured. A stored company licence reference is neither verified entitlement nor platform distribution permission.

The [Responsible use of AI standard](https://www.rics.org/profession-standards/rics-standards-and-guidance/conduct-competence/responsible-use-of-ai) requires a documented suitability/risk assessment for material use; appropriate qualified review and a recorded reliability decision; and written client disclosure in advance of material AI use. Disclosure covers its purpose, relevant safeguards and routes to challenge results. Verify actual practice workflow and evidence against the published standard rather than interpreting blue prefill as sufficient compliance. Sources, assumptions, human edits, reviewer identity and final decisions must remain auditable.

## What exists in this checkout

| Capability | Current position |
| --- | --- |
| Two recording views | Section form and guided questionnaire share field paths and provenance. |
| Photos | Capture, private original storage, contextual evidence links, offline queue. |
| Video | MP4/WebM capture, original container checks, private playback with byte ranges, offline queue and evidence links. No AI video interpretation or transcoding. |
| Review exports | Printable draft HTML; central licensed PDF adapter supports mapped answers and linked JPEG/PNG photographs only when authorised assets are provisioned. All output answers are black. |
| Video in PDF | Explicitly rejected when linked; never silently discarded. Customer media supplement is not implemented. |
| Customer report | Existing quote-token portal displays approved current text only. It now denies access after one calendar year from report approval, including receipt acknowledgements. |
| Company retention | One calendar year from later verified final delivery/closure. Countdown appears in the file assessment; company extension is offered in the final 30 days and after expiry. |
| Archive extension | Manager-only, records date/reason, checks current membership and reviewed file version, increments job version, invalidates old removal eligibility; refuses extensions after removal has started. Does not extend customer access. |
| Deletion | Existing explicit manager review/removal workflow, legal holds and claim protections continue. The countdown is labelled deletion review because expiry does not itself authorise automatic deletion. |

Apply generated database migrations 0080 and 0081 before live use. Live uploads require private object storage; demo media stays on the device. The default file limit is 25 MB, configurable up to 100 MB. MP4/WebM browser codec support varies; a valid container is not a guarantee of playable encoding.

## Required customer compilation and publication design

This design is not yet implemented. Formal issue remains blocked by the authorised template and review gates.

1. Freeze the professionally approved report version, template version, answers, approved customer-facing captions and selected media in an immutable publication manifest. Record original checksums and the generated PDF checksum. Do not assemble an issued report from subsequently edited survey answers.
2. Preserve the centrally supplied RICS template and required appendices. Put relevant photographs in their mapped positions or approved photographic appendix with section/element references. Produce a downloadable PDF with black answers and the supplied RICS styling; do not replace the RICS layout with tenant colours.
3. Video belongs in a separate customer media supplement: poster image, caption, section reference and accessible transcript where applicable. The PDF can contain the authenticated supplement URL/QR. Downloaded PDFs must explain that online video access expires; offer separately downloadable published media for offline retention. A PDF is not a video archive.
4. Snapshot tenant trading name, logo and contact details for the customer-facing portal and allowed template branding slots. Respect supplier restrictions on branded templates. The portal must display only that tenant's selected publication for that job/customer.
5. Add customer identity verification (email OTP or authenticated client account) bound to tenant, customer and job, with revocation and rate limits. The current hashed bearer quote token is job-scoped but transferable: it does not establish that only the intended client is using the link. Never expose staff media routes or private storage addresses as customer URLs.
6. Serve PDF, thumbnails and videos through publication-scoped authorisation on every request, including range requests. Require manifest membership, approved/issued version, matching tenant/customer/job, non-revoked access and unexpired deadline. Keep responses private and uncached. Log actual receipt separately from merely opening a response.
7. Customer access remains one year. Company extension retains the complete issued publication, media, report versions and required professional evidence together, independently of customer access. The current report approval timestamp is the customer access anchor; a dedicated first-publication timestamp should replace it when immutable publications are introduced.

## Remaining acceptance gates

- Obtain authorised central template assets, field mappings, supplier distribution permission and professional acceptance for each supported service/version.
- Validate report completeness against the selected level, including terms, required appendices, restrictions, energy information, declaration, and reasoned further investigations.
- Implement the frozen publication and identity-bound portal before claiming client-only media delivery or a final customer PDF download.
- Verify expired access cannot return originals, thumbnails, media ranges or downloads; extension cannot reopen customer access; cross-tenant and cross-customer guesses fail.
- Exercise the migrations, real object store, concurrency and deletion/extension races with a test database. Unit tests and demo UI cannot establish live retention guarantees.

## Verification completed

500 web unit tests passed, including archive permission/version/date checks, customer expiry despite an extended company archive, and authenticated video ranges. Web and database type checks passed. Browser verification found nine video capture controls in the outside-property section, no page errors, and preserved blue prefill/black manual text, cross-view editing and reload persistence. Live database/storage and formal RICS delivery remain unverified.
