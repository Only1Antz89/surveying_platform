# Completion rules and the stage gate (A3)

> **Status: product defaults that require review by a qualified surveyor before production use.** The rule set records this as `reviewStatus: "draft_requires_surveyor_review"`.

Completion checks help the surveyor finish a survey consistently. They only ask for information. They never fill a field, choose a condition rating or write report text.

## Where the checks run

- **On the device:** the survey workspace shows a "Completion checks" panel computed from the survey pack. It works offline, and says when changes saved on the device are not yet included.
- **On the server:** moving a job to `internal_review` or `issued` (`PATCH /api/v1/jobs/:id`) runs the same engine inside the stage-change transaction. `GET /api/v1/surveys/:id/completion` returns the full checklist.

Jobs without a survey are not gated. These are records created before survey capture existed. The newest non-withdrawn survey for the job is checked.

## What is checked

| Category | Severity | Overridable | Source |
|---|---|---|---|
| Required fields for the service level (an explicit "not applicable/inaccessible/not inspected/unknown" state with a reason counts) | Hard gate | No | Template |
| Inspection status recorded for every building element | Hard gate | No | Template |
| Status and condition rating agree (for example, no rating 1–3 on an inaccessible element; no NI on an inspected one) | Hard gate | No | Engine |
| Versioned rules (below) | Per rule | Per rule | Rule set |
| Open discrepancy tasks (A2) | Hard gate | Yes | Tasks |
| Open "review AI text" tasks | Hard gate | **No** | Tasks |
| Photos marked for the report but not attached to an element or observation | Hard gate | Yes | Media |
| Other unattached photos | Advisory | — | Media |
| Unreviewed suggestions | Advisory | — | Proposals |
| Open reminders from earlier surveys (A1) | Advisory | — | Tasks |

## Rule set `surveynt-residential-rules@1.0.0` (template `surveynt-residential@1.0.0`)

| Rule | Trigger | Requires | Severity | Override reasons |
|---|---|---|---|---|
| `FLAT-COMMUNAL` | Property type flat or maisonette | Communal areas status; tenure answered | Hard gate | Communal areas excluded by instructions; access not available; other |
| `EXTENSION-APPROVALS` | Extensions or alterations observed | Approvals to confirm (matters for legal advisers) | Hard gate | Alterations predate approval requirements; other |
| `LIMITATION-RECORDED` | Element partly inspected, not inspected or inaccessible | Limitation recorded | Hard gate | None |
| `SERIOUS-RATING-COMMENTARY` | Condition rating 3, at any service level | Surveyor commentary | Hard gate | None |
| `DEFECT-DETAIL` | Observation classified as a defect | Location, at least one item of evidence, next action | Hard gate | Evidence could not be captured safely; other |
| `LISTED-GRADE` | Listed building record | Grade or category answered | Advisory | — |
| `ROOF-SPACE-GENERAL-LIMITATION` | Roof structure not inspected or inaccessible | General limitations | Advisory | — |

A rule set is pinned to the template versions it was written for (`ruleSetForTemplate`). A template version with no rule set reports "no rules" rather than passing.

## Overrides

- Only owners, administrators and surveyors may record reasons. Coordinators see the failures and must ask a surveyor.
- Every failing hard gate needs one of its permitted reasons. "Other" needs a note of at least 10 characters. Checks with no reasons (for example, unreviewed AI text) must be resolved.
- Accepted overrides are stored in `completion_overrides`. Each row holds the item, rule, rule set version, template version, target stage, reason, note, user and time. Rows cannot be updated or deleted, and an audit event is written. If the stage change fails, nothing is kept.

## Defects

A current observation can be classified as a defect with a next action: monitor, repair, replace, further investigation, specialist report, or obtain documents. Only surveyor roles can do this. A location can be given ("rear elevation"), and photos of the element can be linked to the observation as evidence.

## Fixtures

`packages/assistant/src/rules/rules.test.ts` builds a complete survey for each service level from the template itself, then breaks it one way per test. `apps/web/test/completion.integration.test.ts` exercises the gate against the database.
