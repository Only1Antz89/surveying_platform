# Shared learning: contribution policy (draft)

Status: **draft for legal, data-protection and professional review. Not published. Shared learning is disabled.**

This document is the policy text referenced by `learning_policy_versions.policy_document_ref`. Publishing a version in the platform console requires:

- a reference to an approved privacy assessment (see [`privacy-assessment.md`](./privacy-assessment.md));
- release criteria set by qualified reviewers.

Until both exist, the programme stays inactive whatever the `SHARED_LEARNING_ENABLED` flag says.

## Purpose

Shared learning gives every Surveynt firm the same reviewed baseline of surveying knowledge, including new firms with few clients. Contribution volume must not determine the quality of assistance a firm receives.

| Layer | What it holds | Who sees it |
|---|---|---|
| Tenant workspace | Client identities, addresses and UPRNs, surveys, photos, documents, review logs | The firm only (row-level security) |
| Restricted staging (`learning_restricted`) | Minimal candidate copies, pseudonymised lineage, rights metadata, sanitisation results, review decisions | The learning service role and assigned platform reviewers. **Still treated as personal and confidential data** |
| Shared knowledge (L2) | Released, generalised, reviewed cases | Every assistant-enabled firm, read-only, with no contributor identity |
| Public property data | Reference datasets (P0–P6) | Separate layer, unaffected by this policy |

## Principles

1. **Off by default.** Three independent switches must agree before anything is copied:
   - the platform flag;
   - a published policy version with a privacy assessment and release criteria;
   - the firm's own grant for the specific scope.
2. **Assistance does not depend on contributing.** Shared retrieval is identical for every assistant-enabled firm. There are no incentives tied to contribution volume.
3. **Separate scopes, separate confirmations.** A firm switch alone is not sufficient. Each scope needs an owner or administrator to:
   - confirm authority over client information;
   - confirm rights to any third-party material;
   - accept the current policy version;
   - record where that authority is set out (for example, a clause in the terms of engagement).
4. **Minimal extraction.** Only surveys with a signed-off report are considered. Material is copied one building element at a time: rating, observations, limitations and generalised context. Whole surveys, client archives, documents and original photos are never bulk-copied.
5. **No automatic self-training.** A surveyor's accepted draft is feedback, not ground truth. Nothing trains continuously. Any model change would come from a reviewed dataset release and a measured, approved model release (L4, not implemented).
6. **Withdrawal is always available** and takes effect immediately (see below).
7. **Never called anonymous.** Restricted staging is pseudonymised: lineage is kept so withdrawals and corrections work. Released cases are generalised and reviewed, but this policy makes no claim that the system as a whole is anonymous.

## Contribution scopes

| Scope | Meaning | Implemented behaviour |
|---|---|---|
| `structured_cases` | Element-level cases from signed-off surveys | Extraction, sanitisation and review pipeline (L1–L2) |
| `photos` | Defect photos, stripped of metadata and cropped | Metadata stripping and cropping exist and are tested. **No photo is copied or released** until a reviewed crop-and-review tool exists; the count is recorded only |
| `evaluation` | Use of released cases in held-out test sets | Evaluation split design (L3); never used for training |
| `model_training` | Eligibility for a future fine-tuning experiment | Eligibility rules only (L4); nothing is trained |

## Roles

| Role | Where | Can |
|---|---|---|
| Firm owner or administrator | Firm settings → Shared learning | Grant or revoke scopes, with confirmations |
| Anyone who can edit firm records | Same page | Request withdrawal of a job or a scope |
| Compliance (platform) | Platform → Shared learning | Draft and publish policy versions |
| Privacy reviewer | Platform → Shared learning | Approve or reject sanitised candidates (privacy checks, linkage checks) |
| Technical reviewer (L2) | Platform → Shared learning | Write the reviewed, generalised case; must not be the same person as the privacy reviewer |
| Release manager (L2) | Platform → Shared learning | Curate, approve, activate and roll back releases; run the sweep |
| Learning service (database role) | Server only | Write restricted staging; cannot read tenant tables |
| Tenant application role | Server only | Cannot read restricted staging; can read released shared cases (L2) |

Every review, release and withdrawal decision is written to the restricted audit log (`learning_restricted.audit_log`, append-only). Firm-side grant and withdrawal actions are written to the firm's audit trail.

## Withdrawal and retention

Withdrawal of a job, of the `structured_cases` scope or of everything has these effects:

- Candidate copies are cleared, keeping only a lineage stub (`status = withdrawn`, `content = {}`).
- Sanitisation results and review decisions are erased.
- Released cases are removed from shared retrieval (L2).
- Future evaluation and training eligibility ends.
- A restricted audit entry records the processing.

Other scope effects:

- **Revoking a scope** records the revocation and processes a withdrawal of that scope immediately.
- **Withdrawing `photos`, `evaluation` or `model_training`** affects only eligibility, because no copied material depends on those scopes alone.

There is no full-text cache or embedding store for shared cases. If one is added, it must be keyed by shared case and purged by the same withdrawal step.

**Trained models.** Already-trained model versions cannot have individual records deleted from their weights. Remediation is rollback, retirement and retraining from an eligible corpus. No model is trained today.

Retention periods for restricted staging are **to be set with the DPO**. Until they are, candidates that are not released should be reviewed for deletion at each policy version change.

## Release criteria

Release criteria are recorded with each policy version, as JSON validated by `releaseCriteriaSchema` in `@surveynt/learning`. **They must be set by qualified reviewers, not engineering defaults:**

| Field | Meaning |
|---|---|
| `definedBy` | Who set the criteria (names and roles) |
| `minimumCasesPerRelease` | Smallest release that may be approved |
| `maxContributorShare` | Largest effective share any one contributor may have after weighting |
| `rareCombinationReviewBelow` | Below this many matching staged cases, a case is generalised further, then held for manual review. This threshold triggers review; it does not prove anonymity |
| `minimumTechnicalAgreement` | Optional agreement threshold between technical reviewers |
| `coverageDimensions` | Dimensions reported in each release manifest |
| `licenceScope` | What released content may be used for (for example, shared retrieval inside Surveynt only) |

## Out of scope

The following are not authorised by this policy:

- public dataset publication;
- export of shared cases outside Surveynt;
- federated learning;
- continuous training;
- voice capture;
- any autonomous approval, signing or issuing of reports.
