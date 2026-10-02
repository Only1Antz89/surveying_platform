# Evidence analysis and evaluation pack (A4)

> **Status:** the thresholds are provisional. They were set against synthetic images and documents only. Calibrate them on real, consented survey photos before relying on them.

## What runs today

All of this is deterministic. No AI provider is configured (decision 2026-10-01), so image understanding, OCR and drafted text report **unavailable**.

| Evidence | Analyser | Output | Effect |
|---|---|---|---|
| Photo (JPEG, PNG, WebP) | `photo-quality-v1` (`@surveynt/evidence`, sharp) | Resolution, a blur measure (variance of the Laplacian on a 512 px greyscale copy) and exposure. Flags `low_resolution`, `possibly_blurred`, `too_dark` and `overexposed`, with plain messages | Hints under the thumbnail. Blur is not judged when exposure is extreme (low contrast makes the measure meaningless). HEIC and damaged files report "unavailable"; originals are untouched |
| PDF | `certificate-facts-v1` (unpdf text layer plus `findCertificateFacts` in `@surveynt/assistant`) | Certificate type, reference, inspection, issue and due dates. Each fact has its page and character span. Also reported: instruction-like text and limitations | Shown in "Certificates and documents". A due date before the recorded inspection date (or today) raises a **discrepancy task** with the document span. The completion gate (A3) then requires it to be resolved or explained |
| Scanned PDF (no text layer) | — | "OCR is not available" | Nothing extracted |
| Earlier photos | `GET /surveys/:id/photo-history` | This firm's earlier photos of the same element, from surveys of the same property record or surveyor-confirmed UPRN | Shown side by side for comparison on site. Any difference is labelled a **possible change, not a finding**. No automatic comparison is made |

Analyses run after the upload response (`after()`), and a daily sweep backfills any that did not run. Results are stored in `media_analyses`, one row per media item and analyser version. The rows are append-only and tenant-isolated. The erasure routine must delete them before their media.

Not done here, on purpose:
- Element and location tagging is manual. Tag suggestions need image understanding (a model), so they are unavailable.
- Document facts do not yet create field suggestions. That needs a template version that lists document extraction as a permitted source for the guarantees field. Changing `surveynt-residential@1.0.0` would change its pinned fingerprint.
- No dates with two-digit years, and no dates inferred from context.

## Review feedback

Rejected suggestions are kept as evaluation feedback with the reviewer's note (A2). Corrections to extracted facts, and dismissed discrepancies with their notes, are kept the same way. **None of this is training data.** Use for model training is governed separately (A6 and L4) and is not enabled.

## Evaluation pack

`packages/evidence/eval/cases.ts` holds labelled synthetic cases. There is no customer data. Run it with:

```bash
pnpm --filter @surveynt/evidence eval
```

It also runs in `pnpm check` (`src/evaluation.test.ts`). Every case must pass, every case labelled "abstain" must abstain, and there must be no unsupported claims.

| Case | Capability | Expected |
|---|---|---|
| `photo-blur` | Photo quality | Blurred image flagged; sharp image not |
| `photo-dark` | Photo quality | Too dark; blur not judged |
| `photo-low-resolution` | Photo quality | Low resolution |
| `misleading-scale` | Image understanding | **Abstain.** No measurement or rating from a photo, and a model rating from a photo alone is refused by validation (`professional_assessment_from_photo`) |
| `damp-like-staining` | Image understanding | **Abstain.** Quality only; no defect, cause or rating |
| `stale-certificate` | Document extraction | Due date with page reference; expiry check raised |
| `prompt-injection-document` | Injection | Instruction-like text reported and ignored. Facts still extracted, no field changed, and model input wrapped as untrusted data |
| `scanned-document` | Document extraction | **Abstain.** OCR unavailable |
| `ambiguous-date` | Document extraction | **Abstain.** Two-digit year not used |
| `no-record-is-not-negative` | Sourced suggestions | "No record found in checked sources", never "not listed", with a not-proof limitation |
| `repaired-old-defect` | History | Reminder only, advisory, no rating |

Metrics reported: cases passed, correct abstentions out of abstention cases, and unsupported claims (claims made where the label expects abstention). Latest run on 2026-10-02: **11/11 passed, abstentions 4/4, unsupported claims 0.**

Add a case when a new capability or failure mode appears: a synthetic input, the expected behaviour, and whether abstention is correct. Before any AI provider is enabled (A6), the same pack must run against it with the provider's outputs passed through `validateModelProposals`.
