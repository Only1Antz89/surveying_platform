# Shared learning: fine-tuning gate (L4)

Status: **not implemented, by design.** No model provider is configured (`AI_PROVIDER=none`), nothing trains, and no release exists. This document records the procedure and the gate an optional experiment would have to pass.

The platform console's "Fine-tuning (L4)" panel shows the gate live. It is computed by `fineTuningGate` and `trainingEligibility` in `@surveynt/learning`; both are unit-tested.

## When fine-tuning could be considered

Only when the evaluated retrieval baseline ([`operations.md`](./operations.md#held-out-evaluation-retrieval-baseline)) has **specific, documented failures** that tuning could plausibly address. Fine-tuning is not a default next step, and there is no automatic or continuous training.

## Gate

Every condition must hold. The console lists each unmet one.

| Condition | Source today |
|---|---|
| An approved model provider exists in the platform model register (A6) | None registered |
| The retrieval baseline has been evaluated on held-out firms and properties | Recorded when an evaluation run exists |
| Specific baseline failures have been identified that tuning could address | Not recorded: requires qualified reviewers |
| A measured benefit over the retrieval baseline, from an experiment on held-out data | None |
| Memorisation and privacy-leakage tests have passed (for example canary extraction, membership inference, verbatim reproduction of rare cases) | None. Weights are not automatically anonymous |
| A model retirement and retraining procedure is approved (below) | Draft only |
| The eligible corpus meets a minimum size set by qualified reviewers | Not set |

## Eligible material

A case is eligible only when all of these hold:

- it is in a release;
- it has not been withdrawn;
- its firm currently grants `model_training` under the current policy version.

Pending, rejected, quarantined, withdrawn and insufficient-rights material is never eligible. Feedback is never eligible.

## Procedure (draft, for approval before any experiment)

1. **Proposal.** Record:
   - the baseline failures being targeted;
   - the release version and eligible case count;
   - the provider and model from the register;
   - processing location and retention terms.
2. **Data export.** Export only eligible cases from the active release, as a restricted, audited export of shared fields only, with no lineage. The audit records the export.
3. **Splits.** Use the same held-out firms and properties as the baseline evaluation. No property may appear in both training and test sets.
4. **Training.** Training runs outside Surveynt under the provider's terms. The training recipe and resulting artefact (weights or adapter) are versioned.
5. **Evaluation.** Use the same metrics as the baseline, plus:
   - unsupported claims and appropriate abstention;
   - rating disagreements;
   - editing burden, measured in a pilot under A6 rules;
   - memorisation and leakage tests.

   Results are compared with the retrieval baseline by segment (new, small and large firms; jurisdictions).
6. **Decision.** Qualified reviewers and compliance approve or reject. Approval registers the tuned model in the A6 model register like any other model. Firm-level AI settings and client consent still apply.
7. **Rollout.** Staged rollout with monitoring, under the pilot stages in [`../assistant/pilot.md`](../assistant/pilot.md).

## Withdrawal and remediation for trained models

Individual records cannot be removed from trained weights on request. If a firm withdraws, or a case is found to be identifying or incorrect:

1. The case is removed from retrieval and future training eligibility at once (implemented).
2. Every model version trained on a corpus containing the case is identified from the training recipe's release version and the restricted release items.
3. Those versions are retired or suspended in the model register, and a replacement is retrained from an eligible corpus, on a timescale set in the approved procedure.
4. Firms are told about this remediation in the contribution policy before they grant `model_training`.

## Out of scope

The following would each need separate approval:

- federated learning (model updates can leak information and need their own evaluation);
- continuous or per-correction training;
- publishing a dataset or model outside Surveynt.
