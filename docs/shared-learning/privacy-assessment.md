# Shared learning: privacy assessment (working draft)

Status: **working draft. It is not a completed DPIA and has not been approved.** The programme cannot be published without the reference of an approved assessment (`privacy_assessment_ref`).

This draft records the engineering facts a data protection officer needs. It does not reach legal conclusions. Controller and processor roles, lawful basis, notices and contribution rights must be confirmed by qualified advisers before the pipeline is enabled. Anonymisation is itself processing of personal data.

## Guidance checked

| Source | Status | Notes |
|---|---|---|
| ICO, *Introduction to anonymisation* and *How do we ensure anonymisation is effective?* (the brief's links) | **Not read from source.** `ico.org.uk` is blocked by this environment's egress policy (2026-10-02) | Search results report that the ICO published final anonymisation and pseudonymisation guidance on 28 March 2025. It covers identifiability, the "motivated intruder" test, and generalisation and randomisation techniques. The brief notes the guidance "states it is under review". Re-read the current pages before approval |
| UK GDPR and Data Protection Act 2018, as amended (including any changes made by the Data (Use and Access) Act 2025) | Not reviewed here | For the DPO |
| RICS *Responsible use of artificial intelligence in surveying practice*, 1st edition | Corroborated by search only | Search results report publication in September 2025, effective 9 March 2026, mandatory for members and regulated firms. Check the current edition before release |

## Data flows

1. **Tenant workspace → restricted staging.** Triggered only for a firm with a current `structured_cases` grant, a published policy and the platform flag on, and only for surveys with a signed-off report. Copied per element:
   - jurisdiction, service level and template version;
   - property type, built form, construction period, estimated year and storeys;
   - the element's inspection status, rating, construction text, commentary, limitations and observations (with kind);
   - a count of linked photos.

   Never copied: client, contact and firm identity, addresses, UPRNs, coordinates, job references, documents, photos.
2. **Sanitisation (deterministic, `sanitiser-v1`).**
   - Redacts:
     - known names and contact details from the workspace (client, contacts, firm and members);
     - the property's address parts and UPRN, and the job reference;
     - pattern matches for e-mails, URLs, file names, coordinates, OS grid references, postcodes, UK phone numbers, references, long numbers, street addresses and titled names.
   - Reduces full dates to the year.
   - Generalises:
     - the construction period and year into six bands;
     - four or more storeys into "4 or more".
   - Drops location labels.
   - Lists remaining capitalised words for the reviewer.
   - Flags every case "free text must be rewritten".
3. **Rare-combination check.** If fewer than the threshold of staged cases share the combination (jurisdiction, property type, built form, age band, storeys, element, rating), built form and storeys are dropped. If the case is still rare, it is quarantined for manual review.
4. **Privacy review.** A privacy reviewer confirms six checks:
   - identifiers removed;
   - free text read;
   - rarity assessed;
   - linkage tested against property listings;
   - linkage tested against planning records;
   - linkage tested against other public sources and earlier releases.

   Rejection needs a reason.
5. **Technical review (L2).** A different person writes the generalised case that would be shared. The reviewer's text is scanned again for identifiers.
6. **Release (L2).** Curated, weighted and approved by a release manager after privacy sign-off. Only released cases reach `learning_shared`.

## Identified risks and mitigations

| Risk | Mitigation in code | Residual risk / owner |
|---|---|---|
| Free text contains unique narratives (for example a family event) that identify a household | Free text is always flagged for rewriting; the shared text is authored by a reviewer, not copied | Reviewer judgement. Training for reviewers: **to do** |
| Rare property and element combinations link to a listing or planning record | Generalisation plus quarantine below the reviewers' threshold; manual linkage checks | No fixed threshold proves anonymity; reviewers decide |
| Hashing an address or UPRN mistaken for anonymisation | Lineage keys are keyed HMACs (`LEARNING_LINEAGE_SECRET`), kept only in restricted staging | Restricted staging remains pseudonymised personal data |
| Photo metadata (EXIF and GPS) or content (faces, plates, house numbers) | Metadata stripping and cropping tested; **no photo is copied or released** | Photo release needs a reviewed tool and DPO approval |
| Tenant role reads restricted staging, or the learning role reads tenant data | Separate schemas and roles; integration-tested denial both ways | Operator must not grant `surveynt_learning_write` to the app role |
| Withdrawal not honoured | Immediate propagation, processing retried by the daily sweep; integration-tested | Trained models: rollback and retraining only (none exist) |
| Contributor dominance biases the corpus | Down-weighting to the maximum share; duplicates removed per property and element | Reviewers set the cap |
| Case frequencies read as defect prevalence | Policy forbids it; no aggregate defect-rate feature exists | — |

## Open questions for the DPO

1. Controller and processor roles for staging, review and shared retrieval.
2. Lawful basis for each processing step, including the anonymisation processing itself.
3. Wording for firms' client notices and terms of engagement. The grant records where each firm's authority is set out, but Surveynt does not verify it.
4. Retention periods for restricted staging and the audit log.
5. Whether released cases are anonymous in context, or must be treated as pseudonymised personal data with corresponding controls.
6. Assessment of linkage across releases before the second release.
