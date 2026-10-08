# Whole-form stakeholder test guide

Use an authenticated **private demo practice**, not the read-only preview or a live firm. All prepared statements are fictional and labelled. No external payments, email or calendar actions should occur.

## Prepare the scenario

1. As the demo Owner, enable whole-form evidence in firm Operations settings.
2. Open the demo launch panel. Expand **Whole-form evidence scenario** and select **Prepare fictional evidence**. Existing customer answers are not replaced. Repeating this action should prepare zero additional submissions.
3. Review a job's customer questionnaire. Confirm the fictional statements appear, including unknown extension completion and requested-but-not-supplied documents. Only valuation jobs receive a fictional agreed purchase price.
4. Use a surveyor assigned to that job, or an Owner with an explicitly audited recording permission grant. Preparing the fixtures does not grant either recording or report approval permissions.
5. Start a Home Survey 1.2.0, or explicitly upgrade an in-progress 1.0/1.1 survey. Existing pinned surveys are never upgraded by fixture preparation.

## Exercise evidence review

1. Load evidence. Check the source/readiness labels. Unconfigured EPC/weather sources must remain unavailable, not simulated as verified live records.
2. Open evidence beside a mapped question. Accept one customer statement, edit another and reject another. No condition rating, defect, safety conclusion, valuation or declaration should be supplied automatically.
3. Reload the job and survey. Accepted values must persist and retain source provenance.
4. Correct and resubmit customer answers. An older pending suggestion from the previous submission must be rejected as stale. Reload evidence to review the new version.
5. Repeat fixture preparation. The corrected submission must remain unchanged.

## Documents and completion dates

Private document storage must be configured for document testing; text questionnaire tests do not require it. In the demo panel, select a converted quote under **Document scenario job**, then select **Prepare fictional documents** as the Owner. Open the linked job's questionnaire to review/download the three clearly named test PDFs. Repeating preparation skips existing fixtures, including retained originals that have been replaced. No works association is supplied by preparation.

The blank/manual-review fixture is deliberately an empty PDF without a text layer, not a fabricated scanned certificate. Its filename identifies its purpose. Use fictional PDF/JPEG/PNG originals only for additional upload tests.

- Upload a text PDF containing a certificate issue date only: it must not propose an extension completion year.
- Upload a text PDF with an explicitly labelled works completion date. A practitioner must confirm the property and works association with a reason before a completion-year suggestion becomes available.
- Replace that document. The original remains retained, and any pending suggestion from the replaced document must fail its freshness check.
- Upload a scanned/image-only example: show manual review/OCR-unavailable status, not invented text.

## Access and failure checks

- Owner without recording permission can prepare statements, but cannot create professional findings. Administrator, Manager and Surveyor cannot operate fixture preparation.
- An unassigned surveyor cannot read the questionnaire or its private documents. A customer link cannot expose staff observations or another job.
- Rotate/revoke a customer link and verify the old link no longer works. The questionnaire also needs its separate expiring purpose token.
- Repeated purpose-link requests stop at ten per job per minute without invalidating the last successfully issued token.
- Disable the evidence flag or deactivate membership: further collection/preparation is denied without deleting previous audit or submission history.
- Offline edits remain subject to permission and stale-source checks when reconnecting. Offline revocation cannot take effect before reconnection.

## Current release boundary

Automated local database/service checks cover these access and persistence rules, fixture idempotency, no automatic works association, missing storage and rollback after partial storage failure. Authenticated browser end-to-end, offline/device and full release verification remain outstanding. No production migrations or deployment were performed for this work. EPC/weather approvals, document storage and other integration credentials remain operator-controlled prerequisites.
