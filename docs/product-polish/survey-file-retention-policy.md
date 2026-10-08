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

Approved recorded-answer and observation content disposition now also scrubs matching offline sync replay results in the same database transaction (migration 0070). Operation identities, actors and timestamps remain; saved result payloads become identity-only removal markers. Duplicate sync requests return those markers, and database guards block restoration or movement of cleaned ledger records. Existing disposed-source copies are included in the migration cleanup. This is verified locally with disposable databases; hosted migration and authenticated acceptance remain pending. Element limitation text and other secondary payloads still require an audit before complete file-content cleanup can be claimed.

Reviewed inspection-element cleanup is now implemented locally with migration 0071 and manager API/UI controls. It clears private locations and limitation notes, preserves element identity/status/history, and replaces matching set-element replay payloads with identity-only markers. Unique identity-derived location markers avoid collisions between multiple locations. Capture displays removal explicitly and blocks element editing. Held, premature, stale and foreign-practice cleanup is rejected. Hosted installation and authenticated acceptance remain pending; other secondary payloads, including media capture context, still require audit.

Reviewed media metadata cleanup is implemented locally with migration 0072 and manager API/UI controls. It clears capture context and original filename only after completed, verified whole-file removal, exact manifest hash and object identity/path/checksum/size checks. Remaining original columns and removal history are preserved. Holds, incomplete removals, unrelated originals, stale decisions and foreign practices are rejected; restoration is blocked. Local full regression passed, including a document legal hold bound only through the manifest. Hosted installation and authenticated/live acceptance remain pending.

Reviewed evidence annotation cleanup is implemented locally with migration 0073 and manager API/UI controls. Notes and regions become removal markers after exact completed-file review; link identities, target/evidence bindings and history remain. Held, incomplete, stale, foreign-practice and unrelated-survey decisions are rejected. Capture metadata marks removed annotations and does not expose marker regions as geometry. Local full regressions passed; hosted installation and authenticated/live acceptance remain pending.

Reviewed customer-statement cleanup is implemented locally with migration 0074 and a manager control. Questionnaire drafts and every submitted version are fenced once removal reaches storage dispatch; after completed removal, the answers become removal markers while version numbers, sources and dates remain. Shared-learning staging now skips files under removal, and the daily sweep erases staged and released copies of removed files. The full class-by-class result, and the records retained pending a practice or legal schedule decision, are in [retained-content-audit.md](retained-content-audit.md). Hosted installation and authenticated/live acceptance remain pending.
