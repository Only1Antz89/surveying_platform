# Retained-content audit (survey files)

Status: local audit completed on 8 October 2026 against the merged PR #3 tree plus migration 0074. Verified with disposable PostGIS databases only. No hosted migration, live storage removal or authenticated staging acceptance has been performed.

Scope: every place Surveynt stores content from a survey job file (reports, inspection records, media, evidence, customer statements, offline copies and derived copies), and what happens to it under the one-year policy (`survey-file-1-year-v2`) after a manager-approved, completed whole-file removal.

Method:

- Enumerated every table in `packages/db/src/schema.ts`, including the `learning_restricted` and `learning_shared` schemas.
- Matched each table against the removal manifest (`survey-file-removal-manifest.ts`), the review register (`survey-file-retention-register.ts`), the ten `survey-file-*-disposition.ts` functions and the guard triggers in migrations 0055–0073.
- Followed device-side copies (`offline-store.ts`, `public/sw.js`) and queue payloads (`background_jobs`).

## Outcome by content class

| Content | Where | Under removal | After completed removal | Evidence |
|---|---|---|---|---|
| Report originals and delivered documents | Storage; `organisation_documents` | Manifest objects; fenced | Removed from storage with checksum verification | 0057–0059; journey test |
| Report bodies and trace | `report_versions` | Fenced; immutable | Manager cleanup → marker; identity and checksum kept | 0066 |
| Questionnaire uploads and extracted analysis | Storage; `preinspection_documents` | Manifest objects; fenced | Original removed; analysis → marker | 0060–0061 |
| **Customer statements (questionnaire answers, every submitted version and the draft)** | `preinspection_submissions`, `preinspection_drafts` | **Was unfenced; now fenced (0074)** | **Was retained; now manager cleanup → marker; versions, sources and dates kept** | **0074; journey test** |
| Media originals and derived copies (annotated, thumbnail, redacted, processed) | Storage; `media_assets` | Manifest objects, one per derivation; fenced | Removed; capture context and filename → cleared | 0058, 0072 |
| Media analysis results | `media_analyses` | Fenced; append-only | Manager cleanup → marker | 0062 |
| Recorded answers | `survey_field_values` | Fenced | Manager cleanup → marker | 0068 |
| Observations | `observations` | Fenced | Manager cleanup → marker | 0069 |
| Element locations and limitation notes | `survey_elements` | Fenced | Manager cleanup → identity-derived marker | 0071 |
| Evidence annotations | `evidence_links` | Fenced (survey-bound and external references) | Manager cleanup → marker | 0073 |
| Adviser tasks and field proposals | `assistant_tasks`, `field_proposals` | Fenced, including embedded original references | Manager cleanup → marker | 0063–0065 |
| Server sync replay copies | `sync_operations.result` | Guarded | Scrubbed in the same transaction as the source record | 0070 |
| **Shared-learning restricted staging and released copies** | `learning_restricted.*`, `learning_shared.cases` | **Was not checked; now never extracted** | **Was retained; now erased by the daily sweep like a job withdrawal** | **`propagateFileRemovals`; journey test** |
| Device offline packs, outbox and pending uploads | Browser IndexedDB (per user and practice) | Not reachable from the server | Replaced on the next online load; pruned 30 days after last save, well inside the one-year period; outbox replays against removed records are rejected | `offline-store.ts`; 0070 |
| Service-worker cache | Browser Cache Storage | Application shell only; `/api/` is never cached | n/a | `public/sw.js` |

The removal fence covers storage dispatch and later (`dispatched`, `verification_required`, `completed`). A `queued` removal can still be cancelled, so it is not fenced.

## Changes made in this audit

1. **Customer statements (migration 0074).**
   - New fence trigger on `preinspection_drafts` and `preinspection_submissions` while a removal is dispatched or later.
   - New action `dispose_questionnaire_answers` in `POST /api/v1/jobs/:id/retention/removals`, with a manager control in the retention review.
   - The cleanup replaces every version's answers with `{"retentionRemoved":true}`. It requires all of the following:
     - current management membership;
     - an eligible file;
     - the exact completed removal ID and manifest version;
     - no complaint, claim or legal hold, including document holds bound only through the manifest.
   - The database function `authorised_questionnaire_answer_disposition` independently checks the audit event, the role and the holds. The submission immutability trigger accepts only that change, so restoration and deletion are rejected.
   - The audit event keeps a content fingerprint and counts, never the statements.
   - Staff and customer reads report `contentRemoved` instead of showing empty answers.
2. **Shared learning.**
   - Extraction skips any job with a non-cancelled removal.
   - The daily sweep (`runLearningSweep` → `propagateFileRemovals`) handles removals that are dispatched or later. It clears staged candidate copies, deletes sanitisation and review records, removes released cases from every release and records `retention.file_removed` in the restricted audit log.
   - This path is inert while shared learning is unconfigured (`DATABASE_LEARNING_URL` unset), and no real case has been staged.

## Retained by design, needing a practice or legal decision

These records are not removed by the survey-file cleanup. Each needs an explicit schedule decision before live removal is enabled. None is a claim that removal is complete.

| Record | Content | Why it is kept now | Decision needed |
|---|---|---|---|
| `report_approvals` | Fixed approval statement, optional `note`, completion checklist snapshot | Professional sign-off evidence for a report whose identity is kept | Whether the optional note is cleaned with the report body |
| `completion_overrides` | Override reason and optional `note` | QA accountability for issue gates | Same as above |
| `job_stage_events.reason` | Free-text stage-change reason | Basis for the closure date in the retention calculation | Keep (needed for the date basis) or clean after completion |
| `customer_quotes.answers` | Enquiry answers, including free-text concerns | Commercial/CRM record that predates the instruction | A separate CRM retention schedule (ICO storage limitation) |
| `communication_deliveries`, email `background_jobs.payload` | Recipient, subject and delivery IDs; message bodies are rendered at send time and not stored | "Relevant correspondence" kept together with the file under the selected policy | Correspondence schedule |
| `ai_consent_records`, `ai_incidents` | Consent notes; incident descriptions and related-record pointers | AI governance accountability | Governance schedule; incidents should outlive the file |
| `audit_events` | Append-only metadata. Disposal events hold fingerprints, not content | Tamper-evident history | None. The audit confirmed no disposal event stores removed text |
| Released, generalised shared cases from other files | Sanitised and reviewed; no lineage | Not derived from the removed file | None |

## Not yet verified

- Hosted installation of migrations 0055–0074 and application-role behaviour on staging.
- Live storage removal and lost-response recovery against the real Blob store, using disposable staging originals only.
- An authenticated browser run of every manager cleanup control (tasks 2 and 3 of the remaining work).
