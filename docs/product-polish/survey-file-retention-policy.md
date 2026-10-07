# Survey file retention policy proposal

Status: one-year application policy selected by the user on 7 October 2026; implementation in progress. Practice activation and removal approvals remain separate recorded decisions. This document does not authorise removal or change the current job/report protection.

## User-selected rule

Retain survey job files for one year from the later of final report delivery or recorded job closure. At expiry, place the file into manager review; expiry alone must never trigger deletion. Preserve reports, original inspection evidence and relevant correspondence together.

RICS describes 15 years as best practice for project files: [Insurance and record-keeping](https://ww3.rics.org/uk/en/journals/built-environment-journal/insurance-and-record-keeping.html). The user-selected one-year period differs from that professional recommendation. The later-of delivery/closure anchor is an application policy choice, not a quoted RICS requirement. The practice should confirm its policy with its insurer before live removal is enabled.

The ICO requires justified retention periods rather than indefinite storage of personal data: [Storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/). Unrelated personal data needs a separate retention schedule.

## Implementation acceptance requirements

- Record practice policy approval, policy version, effective date and approving actor.
- Record reliable final delivery and closure dates. Missing or disputed dates require review; do not infer a historical date from a record update timestamp.
- Calculate calendar-year expiry consistently, including leap days, and preserve the approved policy version and date basis.
- Reopening a job or delivering a later final report must invalidate any earlier removal approval and recalculate eligibility.
- Complaints, claims and legal holds block removal. Clearing a hold requires an authorised, audited decision.
- Require a manager's recorded approval against current document/job/report versions and the current policy. Stale approvals must fail.
- Review the complete file and its references together. Existing report references cannot simply be ignored to remove an original.
- Keep tenant permissions, immutable removal evidence, checksum verification, durable dispatch boundaries and lost-response recovery.
- Test expiry boundaries, absent dates, holds, reopened jobs, later deliveries, concurrent reference creation and cross-practice denial before release.

## Current application behaviour

The removal endpoint and worker hold job/report originals and referenced report evidence. Ordinary archived unlinked documents have a separate reviewed removal workflow. No hosted policy activation, migration or physical original deletion is authorised by this proposal.

Practice activation is now available locally in Operations settings. The decision stores the policy version, revision, approving manager, time and reason, with an audit event. Concurrent or stale decisions fail; local preview decisions do not persist. Migration 0055 adds the practice policy field and has been validated only in disposable databases. Activating the configuration does not yet enable survey-file removal: manager review and reference lifecycle integration remain unfinished.

Customers can explicitly confirm receipt of the current approved issued report. The application records one customer acknowledgement per report/customer link with a delivery timestamp and audit. A GET alone does not prove delivery. Historical files lacking delivery or reliable closure evidence require review.

Managers can record complaint, claim or legal holds from the job retention assessment. Every decision requires the current hold revision, a reason and confirmation. Clearing a job hold is audited and leaves document legal holds intact. Both adding and clearing a hold invalidate earlier file review fingerprints. Migration 0056 stores holds separately from ordinary job data, with tenant isolation and a composite practice/job foreign key; hosted application remains pending.
