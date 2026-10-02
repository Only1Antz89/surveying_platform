# Pilot readiness and AI governance (A6)

Status: **governance implemented; no AI provider configured; no pilot started.**

Every assistant feature that ships today is deterministic:

- suggestions from records;
- completion checks;
- photo quality hints;
- certificate facts from a PDF text layer;
- report assembly from approved wording.

None of these calls a model. This document covers the controls that must be satisfied before any model-backed use runs, and the pilot that would follow.

Thresholds below marked **"to be set by qualified surveyors"** are deliberately left open. They are professional judgements, not engineering defaults.

## The governance gate

A model can be used for one purpose on one job only when every condition holds. The gate lives in `packages/assistant/src/governance/gate.ts`; the database loader is in `apps/web/src/lib/ai-governance.ts`. It returns every failing reason, not only the first.

| Condition | Reason code when it fails | Who controls it |
|---|---|---|
| A provider is configured (`AI_PROVIDER` is not `none`) | `provider_none` | Deployment operator |
| The platform model register has an **approved** entry for that provider covering the use | `not_registered` | Platform staff (compliance), after evaluation |
| The firm has turned AI features on | `firm_disabled` | Firm owner or administrator |
| The firm has permitted this use | `use_not_permitted` | Firm owner or administrator |
| An approved risk assessment covers the use | `no_risk_assessment` | Drafted by the firm, approved by an owner or administrator |
| That assessment is within its review date | `risk_review_overdue` | Firm |
| The client's consent is recorded for the job | `no_consent` | Surveyor or coordinator, from the client |
| The latest consent is not a withdrawal | `consent_withdrawn` | Client |
| The consent covers this use | `consent_scope` | Client |
| The consent was given against the firm's current disclosure | `consent_disclosure_outdated` | Firm (changing the disclosure text creates a new version) |
| No critical incident is open or under investigation | `open_critical_incident` | Firm (closing needs a correction note) |

Application code can obtain a model only through `governedModelFor()`. An ESLint rule forbids importing `getAssistantModel`, `noProviderModel` or `getGovernedModel` anywhere else in the web app. A blocked use receives a model that answers `unavailable` with the gate's reasons.

### Uses

| Key | Meaning |
|---|---|
| `field_proposals` | Field suggestions drafted by a model from records |
| `photo_observation` | Photo descriptions |
| `document_extraction` | Document reading beyond the PDF text layer (OCR, image documents) |
| `report_prose` | Drafted report text beyond approved wording |

There is no use for approving, signing or issuing a report. Those remain surveyor actions in every configuration.

## Records

| Table | What it holds | Mutability |
|---|---|---|
| `ai_model_register` | Provider, model, version, permitted uses, processing location, retention terms, evaluation summary, approval | Platform data; the app role can read but not write (RLS without FORCE, SELECT policy only) |
| `organisation_ai_settings` | Firm switch, permitted uses, disclosure text and version | Owners and administrators; optimistic version |
| `ai_consent_records` | Per job: granted or withdrawn, uses, disclosure version, how given, note | Append-only (immutability trigger); withdrawal is a new record |
| `ai_risk_assessments` | Per use: risks, likelihood, impact, mitigation, review date | Drafts editable. Approved assessments are immutable and can only be superseded |
| `ai_incidents` | Category, severity, description, related job or record, correction note | Status moves forward; closing needs a correction note |

All tenant tables use FORCE row-level security on the organisation. Every change writes an audit event: `ai.settings_updated`, `ai.consent_granted`, `ai.consent_withdrawn`, `ai.risk_assessment_*`, `ai.incident_*`, `ai.model_*`.

## Screens

- **Settings → AI and assistant** (`/app/<firm>/settings/ai`): firm switch, permitted uses, disclosure, approved models, risk assessments, incidents.
- **Job record → AI use on this job**: the status of each use with the first blocking reason, consent recording and withdrawal, and consent history.
- **Platform → Assistant** (`/platform/assistant`): the model register (propose, approve with an evaluation summary, suspend, retire) and aggregate metrics.

## Metrics (platform-wide totals only)

The platform page reports totals and never names a firm. It covers:

- suggestions by origin and review state (accepted, edited, rejected, pending, superseded), plus rejections with a note;
- assistant tasks by kind and status (reinspection, discrepancy);
- completion overrides by rule, where frequent overrides suggest a rule needs review;
- report versions composed and signed off;
- AI incidents by category, severity and status;
- firms with AI enabled out of those with settings;
- operations: background jobs by queue and status, enrichment runs over 7 days, and media analyses by analyser and status.

Abstentions and unsupported claims for the evaluation pack are reported by `pnpm --filter @surveynt/evidence eval` (see [`evaluation.md`](./evaluation.md)).

## Pilot stages

None of these stages has started. A stage begins only when the previous one's exit criteria are met and recorded.

| Stage | Scope | Entry criteria | Exit criteria |
|---|---|---|---|
| 0. Deterministic pilot | 1–3 firms, assistant on (`ASSISTANT_ENABLED=true`), no AI | Migrations applied to the firm's environment; [taxonomy](./field-map.md) and [completion rules](./completion-rules.md) reviewed by qualified surveyors | Suggestion acceptance and edit rates, override frequency and surveyor feedback reviewed. Thresholds **to be set by qualified surveyors** |
| 1. Model evaluation (offline) | No customer data | Provider chosen; data-processing terms and location confirmed; evaluation pack extended for the use | Pack passes with zero unsupported claims and the required abstentions. Pass marks **to be set by qualified surveyors** |
| 2. Register approval | Platform | Stage 1 results attached as the evaluation summary | Model approved for named uses only |
| 3. Limited AI pilot | One use at a time, consenting clients only | Firm risk assessment approved; disclosure written; consent recorded per job | Rejection rate, edit distance and incident count within thresholds **to be set by qualified surveyors**, over a minimum number of jobs **to be set by qualified surveyors** |
| 4. Wider rollout | Additional firms or uses | Stage 3 review signed off by the firm and platform compliance | Ongoing monitoring; risk assessments reviewed by their due date |

### Stop conditions (any stage)

- A critical incident: the gate suspends AI use for that firm automatically until the incident is closed with a correction.
- A model reported unreliable: platform staff suspend its register entry, which takes effect immediately for every firm.
- A withdrawn client consent: the job's uses stop at once.

## Incident handling

1. Anyone who can edit records reports the incident, with its category and severity.
2. An owner or administrator marks it as investigating, and records what was corrected when moving it to corrected or closed.
3. Critical incidents block every use for the firm while they are open or under investigation.
4. Corrections to issued reports follow the firm's existing complaints and correction procedure. This system records the incident; it does not reissue anything.
5. Platform staff review incident totals on the Assistant page. A pattern across firms leads to suspending the model in the register.

## Fine-tuning feasibility

**Not started.** No provider has been chosen and no data is eligible. Any training use depends on the shared-learning gates (L0–L4, disabled by default) and on separate legal and DPO approval. Rejected suggestions are kept as evaluation feedback, never as training data.

## Blockers before any AI pilot

- No AI provider selected. `AI_PROVIDER` has no adapter.
- Provider data-processing terms, processing location and retention not reviewed.
- Client disclosure wording needs legal review.
- Pilot thresholds need setting by qualified surveyors.
- Migrations 0027–0028 are not applied to any Neon branch.
