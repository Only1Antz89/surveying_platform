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

## Activation requirements (confirmed 8 October 2026)

**Current state.** Production has the learning schema, and nothing else.

- According to the 2 October production record, migrations 0000–0025 are applied, including the learning migrations 0010 and 0023–0025.
- The deployed Vercel project has none of these variables: `SHARED_LEARNING_ENABLED`, `DATABASE_LEARNING_URL`, `LEARNING_LINEAGE_SECRET`.
- So the programme is off, and nothing is copied.

**Checking readiness.** Run this from a trusted operator machine:

```
DATABASE_ADMIN_URL=… DATABASE_APP_URL=… DATABASE_LEARNING_URL=… LEARNING_LINEAGE_SECRET=… pnpm --filter @surveynt/web check:learning-activation
```

It is read-only and prints no secrets. It exits non-zero until every software-checkable prerequisite holds. It was not run against production from this environment.

Every row must pass before `SHARED_LEARNING_ENABLED=true` is set:

| # | Requirement | How it is checked |
|---|---|---|
| 1 | Migrations through 0025 are applied (`learning_restricted` and `learning_shared` schemas; `surveynt_learning_write` and `surveynt_learning_read` NOLOGIN group roles) | `migrations` |
| 2 | A **separate** login role, used only in `DATABASE_LEARNING_URL`, is a member of `surveynt_learning_write`. It is not the application or owner role and has no BYPASSRLS. See [`configuration.md`](../property-intelligence/configuration.md#database-roles) | `learning_role` |
| 3 | The application role is a member of `surveynt_learning_read` (to retrieve released cases) and never of `surveynt_learning_write` | `app_role` |
| 4 | `LEARNING_LINEAGE_SECRET` is at least 32 random characters, kept in the secret manager | `lineage_secret` |
| 5 | A published contribution policy has an approved privacy assessment reference and valid release criteria, set by qualified reviewers (`releaseCriteriaSchema`) | `policy`, using the same `programmeStatus` gate the application uses |
| 6 | Active platform staff are appointed as privacy reviewer, technical reviewer and release manager. One platform role per person, so they are different people | `reviewers` |
| 7 | The DPIA and legal review are complete | Not checkable by software. The policy's privacy assessment reference records completion |
| 8 | Then set `SHARED_LEARNING_ENABLED=true` | `enabled` |

**After enabling.** Nothing is copied until:

- a firm grants a scope with all three authority confirmations, under the current policy version; and
- a survey of that firm has a signed-off report.

**What runs automatically.**

- The daily cron (`/api/cron/daily`) runs `runLearningSweep`. Until 8 October this ran only from the console's "Run sweep now".
- The sweep retries pending withdrawals.
- It erases staged and released copies of any survey file whose retention removal has reached storage dispatch or later.
- It extracts new candidates only while the programme is active.
- Withdrawals and removals are still honoured while the programme is off, as long as the learning service is configured.

**Still not met by design.**

- L3 quality and leakage pass marks need qualified reviewers.
- L4 fine-tuning is not implemented ([`fine-tuning.md`](./fine-tuning.md)).
- Photo releases stay excluded until a reviewed cropping tool exists.
