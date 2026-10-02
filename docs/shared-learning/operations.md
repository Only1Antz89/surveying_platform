# Shared learning: operations (L2–L3)

Status: **implemented and integration-tested against synthetic data. Not configured anywhere; no real case has been staged, reviewed or released.**

## Pipeline at a glance

| Step | Who | Where | Outcome |
|---|---|---|---|
| 1. Eligibility | Learning service | Daily cron (`runLearningSweep`) or the console's "Run sweep now" | Only firms with a current `structured_cases` grant, under the published policy, while `SHARED_LEARNING_ENABLED=true`. Only surveys with a signed-off report, and only jobs not withdrawn |
| 2–3. Extraction and sanitisation | Learning service | Restricted staging | One candidate per inspected element with a rating or observations. Sanitised with `sanitiser-v1`. Rare combinations are generalised, or held (`quarantined`) |
| 4. Privacy review | Privacy reviewer | Platform → Shared learning | Six checks to approve; a reason to reject |
| 5. Technical review | Technical reviewer, never the case's privacy reviewer | Same page | Writes the generalised shared case; the text is re-scanned for identifiers |
| 6–7. Release | Release manager prepares and approves; a privacy reviewer signs off | Same page | Whole reviewed corpus with duplicates removed, contributors capped and coverage reported. Rights re-checked at approval. One active release |
| Retrieval | Every assistant-enabled firm | Survey workspace → Reviewed examples; `GET /api/v1/shared-cases` | Same cases for every firm, labelled as examples that do not describe the property |

## Feedback

Any user who can edit records can mark a reviewed example as:

- helpful;
- not helpful;
- incorrect (with a note);
- could identify someone (with a note).

Feedback is handled as follows:

- It is stored in the firm's own `learning_case_feedback` table, is append-only, and is visible to reviewers only as counts and notes, without the firm's identity.
- It is evaluation input for reviewers. **No code path turns feedback into training data.** The training-eligibility rules (`trainingEligibility`) do not read feedback.
- An "identifying" report takes the case out of shared retrieval in every release at once. The candidate returns to the privacy queue as `quarantined`, and the restricted audit log records `case.retracted` by `learning_service`. This is precautionary: one report is enough.

## Corrections and retraction

Reviewers and release managers can retract a released case from the console:

- **For correction:** the candidate returns to technical review (or to the privacy queue, if a privacy reviewer retracted it). The corrected case appears in the next release.
- **Outright:** the candidate is rejected and never released again.

Released cases are never edited in place (a database trigger prevents it).

## Withdrawal

See [`policy.md`](./policy.md#withdrawal-and-retention). Processing is immediate when the learning service is configured, and retried by the daily sweep. A withdrawal does the following:

- removes released copies from every release, active or not;
- updates release case counts;
- marks the release items withdrawn;
- clears the candidate copy and erases its sanitisation and review records.

Approval re-checks rights, so a withdrawal between drafting and approval blocks approval until it has been processed.

## Rollback

"Roll back" in the console marks the active release `rolled_back` and re-activates the most recently superseded one. A reason is required and recorded. Shared cases are stored per release, so rollback needs no re-publication.

## Held-out evaluation (retrieval baseline)

"Run evaluation" stores an immutable `evaluation_runs` record for the active release (method `retrieval-baseline-v1`).

**What counts as a test case:**

- Only cases from firms that currently grant the `evaluation` scope. Others stay on the retrieval side only.
- A share of eligible firms is held out entirely, chosen by hashing the seed with pseudonymous contributor keys.
- Every case of a held-out firm is test-only.
- Properties are sampled into the test set by hashed group key. Every case from one property stays on one side.
- Optionally, cases extracted on or after a date form a later-date test set.

**What is measured:** for each test case, the best-ranked training case for the same element (full-text rank on the observed feature) is retrieved. Metrics are reported overall and by firm-size segment; segment thresholds are an input:

- coverage (answered over test cases);
- abstentions;
- rating agreement at rank 1.

**Leakage checks** (all must be zero):

- property groups on both sides;
- held-out firms on the training side;
- retrieved cases from a test property.

The integration test asserts all three on a 40-case synthetic corpus.

**Pass marks are not set.** The L3 gate ("quality and leakage thresholds met") needs thresholds from qualified reviewers. Until then, results are recorded but approve nothing. Results from synthetic data say nothing about real quality.

## Monitoring

| Signal | Where |
|---|---|
| Pipeline counts by status | Platform → Shared learning → Pipeline |
| Feedback, with "identifying" reports first | Feedback and corrections |
| Release manifests (cases, contributors, largest effective share, duplicates removed, uncovered segments) | Releases |
| Evaluation runs and leakage | Held-out evaluation |
| Every decision | `learning_restricted.audit_log` (append-only) |
| Firm-side grants, withdrawals and feedback | Each firm's audit trail |

## Configuration checklist

Nothing below has been done in any environment.

1. Apply migrations 0029–0034 on a non-production branch first.
2. Create the learning login role and grant it `surveynt_learning_write`. Grant `surveynt_learning_read` to the app role (see [`configuration.md`](../property-intelligence/configuration.md#database-roles)).
3. Set `DATABASE_LEARNING_URL` and `LEARNING_LINEAGE_SECRET`.
4. Appoint platform staff with the `privacy_reviewer`, `technical_reviewer` and `release_manager` roles: different people.
5. Complete the DPIA and legal review. Publish a policy version with the approved privacy assessment reference and the reviewers' release criteria.
6. Only then set `SHARED_LEARNING_ENABLED=true`. Firms still need to grant scopes individually.
