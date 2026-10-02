# Wording library and report assembly (A5)

Reports are **assembled, not written by AI**. The composer (`deterministic-composer-v1` in `@surveynt/assistant`) uses only three things:

1. **Recorded field values.** These are entered by the surveyor, or accepted or edited from a suggestion by a person.
2. **Current observations.** Client statements are always phrased as "The client reported: … This was not verified during the inspection."
3. **The firm's approved wording.** Drafts and retired clauses are never used.

The same inputs always give the same report. Every paragraph lists the records it came from: field values, observations, the clause and its version, photos, and the inspection status.

## What the composer will not do

- **Write text for uninspected elements.** "Not inspected" and "inaccessible" elements get the stated reason, plus any approved limitation clause, and nothing else. Their observations and ratings are left out.
- **Fill a clause partly.** A clause whose placeholder has no value (for example `{location}` where none was recorded) is skipped, and listed under "Left out of this version".
- **Include an element with no inspection status.** It is listed as omitted.
- **Use pending suggestions or unapproved wording.**

## Wording library (`/app/:slug/wording`)

| Action | Who |
|---|---|
| Write or edit a draft | Owners, administrators and surveyors |
| Approve a draft (the previous approved version is retired in the same transaction) | Owners and administrators |
| Retire approved wording | Owners and administrators |
| Delete a draft | Authors |

- Clauses have a key, version, purpose (element narrative, recommendation, limitation, summary, matter for legal advisers) and wording. Optional conditions: element, condition ratings, next actions, inspection statuses, jurisdictions and service scopes.
- Placeholders are limited to `{element}`, `{location}`, `{next_action}` and `{rating}`.
- **Approved wording never changes.** A database trigger allows only retirement. Issued reports keep the exact version they used.
- **Licensed text** (for example a professional body's standard wording) must be marked as licensed third-party wording with its licence reference, which the database enforces. No licensed text ships with Surveynt (decision 2026-10-01).

## Versions and sign-off

1. **Compose** from the survey's Report panel. This creates an immutable `report_versions` row holding:
   - the content;
   - the trace: ids and versions of every value, observation, clause and photo used;
   - the template version and fingerprint, and the rule set version;
   - a hash of every input (`input_fingerprint`) and a content hash.
2. **Review** the preview. Each block's sources can be expanded.
3. **Sign off.** Only a surveyor, administrator or owner can sign off, and only with the exact statement *"I have reviewed this report version in full, including its sources and limitations, and approve it for issue."* The version must be:
   - the latest;
   - unchanged since it was composed (same input fingerprint);
   - free of failing completion hard gates, unless reasons were recorded for them (A3).

   Sign-off is a separate immutable `report_approvals` record. The survey then becomes "approved" and capture closes.
4. **Issue.** Moving the job to `issued` needs a signed-off version that still matches the survey. A report produced elsewhere needs a recorded reason (A3 override).
5. **Reopen** before issue if something must change. The signed-off version then no longer matches, so a new version must be composed and signed off.

Nothing is approved, signed or issued automatically.

## Assistant side panel

On wide screens the survey workspace shows a side column, and on phones the same panels sit above the form:
- completion checks with next actions (A3);
- certificates and documents (A4);
- suggestions and discrepancies with accept, edit and reject (A2);
- the report.

Each item shows its evidence and the reason it exists.

## Not implemented (by decision)

AI-drafted sections. If a provider is approved (A6), drafted text would arrive as `draft_section` tasks with `review_ai_text` gates. The A3 gate already blocks issue while any such review is open, and it cannot be overridden.
