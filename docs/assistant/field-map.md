# Assistant field map (A0)

Status: **draft — requires review by a qualified UK surveyor before production use.** Template: `surveynt-residential@1.0.0` (`packages/assistant/src/forms/residential-v1.ts`), fingerprint `9d5a4d78…3dce1`. The template is Surveynt-authored and contains no RICS or other third-party standard text. Firms that hold licensed template wording add it through their own approved wording library (A5).

## Starting point

Before A0 the repository had no survey form, observation, photo or report model (see [`../property-intelligence/architecture.md`](../property-intelligence/architecture.md)). A0 therefore defines the form model rather than mapping an existing one.

- **Form templates** are versioned, zod-validated definitions (`formTemplateSchema`). A template version is immutable once published: a fingerprint test pins `1.0.0`, and any change needs a new version.
- **Storage:** built-in templates ship in code. A firm or platform variant is published as `practice_pack_versions.definition.form` through the existing compliance-controlled practice-pack workflow. Each survey pins `template_key`, `template_version` and `template_fingerprint` (A1), so later edits never rewrite historic surveys.
- **Field paths** use the form `section.element.field`, for example `outside.roof_coverings.condition_rating`.
- **Value states:** `provided`, `unknown`, `not_inspected`, `inaccessible`, `not_applicable`. These are distinct states and are never collapsed into "No", "Safe" or blank.
- **Element inspection status:** `inspected`, `partially_inspected`, `not_inspected`, `inaccessible`, `not_applicable`.
- **Service scopes:** `level_1`, `level_2`, `level_3`, `bespoke`. These are internal neutral keys. When creating a survey, the surveyor chooses the scope that matches the agreed service; the free-text `jobs.service_name` is never parsed for this.

## Field classes

| Class | Who may set it | Assistant behaviour | Examples |
|---|---|---|---|
| `clerical` | Anyone with write access | May be prefilled from verified internal records, always with provenance and undo. Automatic application only when the firm enables it for that field | Inspection date, weather, EPC certificate reference |
| `factual_sourced` | Surveyor | Proposals from permitted sources or documents are shown as **sourced/unverified** until the surveyor accepts or edits them | Property type, built form, construction period, listed/conservation records, construction description, limitations |
| `professional_assessment` | Surveyor | Draft proposals only, and **never** from a photograph or external record alone. Each value needs explicit confirmation | Condition ratings, commentary, risks, approvals to confirm, overall opinion |

## Selected priorities mapped to the form

### 1. Structured observations and evidence linking

| Form area | Captured as | Evidence links |
|---|---|---|
| Every inspectable element (`outside.*`, `inside.*`, `services.*`, `grounds.*`) | One `survey_elements` row with inspection status and limitation reason, plus observations (A1) | Photos (original plus derived), documents (page/span), intelligence snapshots, prior survey records (as reminders only) |
| `*.construction`, `*.commentary` | Field values with origin, author, event date and approval state | Each material statement links to accepted observations |
| Historical defects from a previous survey of the **same verified property in the same firm** | `reinspect` task, never a current observation | Link to the prior survey snapshot |

### 3. Field-level prefill with verification

| Field | Class | Permitted proposal sources | Notes |
|---|---|---|---|
| `inspection.visit.inspection_date` | clerical | Job schedule (`jobs.target_date`) | Prefill only with provenance; the surveyor confirms on site |
| `about.property.property_type`, `built_form`, `construction_period` | factual_sourced | `epc_england_wales`, `scottish_epc` | EPC values are recorded estimates. The label reads "EPC record: verify during inspection" |
| `about.property.listed_status`, `listing_grade` | factual_sourced | `historic_england_nhle`, `planning_data`, `cadw_listed_buildings`, `hes_designations`, `ni_hed_listed_buildings` | Country routing applies. "No record found" is never "not listed" |
| `about.property.conservation_area` | factual_sourced | `planning_data`, `hes_designations` | Coverage varies by local planning authority |
| `about.property.energy_rating`, `energy_certificate_reference` | factual_sourced / clerical | `epc_england_wales`, `scottish_epc` | Note the certificate date and expiry |
| `about.property.tenure` | factual_sourced | Client statement, documents | Shown as "as reported"; legal advisers confirm |
| Element `construction` descriptions | factual_sourced | EPC descriptive fields, documents | Suggestions until seen on site |

Fields without `proposalSources` accept no external proposals. Proposals from any source not listed for a field are rejected by validation (A2).

### 4. Adaptive forms and completion checks

The full checklist above stays visible for every survey. Adaptive rules (A3) add prompts and completion checks; they never remove elements from the agreed scope. Planned rule triggers:

- `property_type` is `flat` or `maisonette` → prompts for `grounds.communal_areas` and common services.
- `extensions_present` is true → prompts for approvals and certificates in `matters.legal.approvals`.
- Element status `inaccessible`, `not_inspected` or `partially_inspected` → `limitations` is required.
- Condition rating `3` → location, evidence and next action are required.

### 6. Approved wording and report assembly

Every `reportUse: "report"` field feeds report assembly (A5) **only after approval**. Element text is composed from accepted observations and the firm's approved clauses. Uninspected elements produce no generated text.

### 7. Document extraction and image assistance

| Input | May propose | Never proposes |
|---|---|---|
| Client documents and certificates (PDF text layer) | Dates, reference numbers, certificate validity, `matters.legal.guarantees` | That a certificate proves current compliance |
| Photos | Element/location tags (confirmed by the surveyor), factual captions | Condition ratings, causes, urgency, hidden defects, dimensions without scale |

No model provider is configured (decision recorded 2026-10-01), so image understanding and OCR report "unavailable". Deterministic text-layer extraction still works.

## Review needed before production

1. A qualified surveyor reviews the element taxonomy, field requirements and condition-rating labels.
2. Firms confirm how their service names map to the `level_*` scopes.
3. Firms that hold licensed standard wording confirm their licence scope before importing it (A5).
