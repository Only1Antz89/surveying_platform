import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  applyRarityCheck, containsIdentifiers, contributorWeights, curateRelease, evaluateEligibility, extractCandidates, fineTuningGate, privacyDecisionSchema,
  programmeStatus, releaseProblems, reviewedCaseProblems, reviewedCaseSchema, sanitiseCandidate, scanText, technicalDecisionSchema, trainingEligibility,
  type ContributionGrant, type CurationItem, type ExtractionSource, type ReleaseCriteria,
} from "./index";
import { planEvaluationSplits, splitLeakage } from "./evaluation";
import { stripImageMetadata } from "./photo";

const criteria: ReleaseCriteria = { definedBy: "Test panel (synthetic)", minimumCasesPerRelease: 3, maxContributorShare: 0.4, rareCombinationReviewBelow: 3, minimumTechnicalAgreement: null, coverageDimensions: ["jurisdiction", "elementKey"], licenceScope: "Shared retrieval inside Surveynt only; no publication." };
const published = { version: "2027-01", status: "published", privacyAssessmentRef: "DPIA-2027-01", releaseCriteria: criteria };
const known = { names: ["Jane Doe", "Clifton Surveyors", "Maya Patel"], addressParts: ["14 Acacia Avenue", "Bristol", "BS8 1AA"], references: ["SVY-1048"] };

describe("programme and eligibility gates", () => {
  it("stays off unless the flag, a published policy, a privacy assessment and release criteria are all present", () => {
    expect(programmeStatus({}, null).reasons.map((reason) => reason.code)).toEqual(["flag_off", "no_published_policy"]);
    expect(programmeStatus({ SHARED_LEARNING_ENABLED: "true" }, { ...published, status: "draft" }).active).toBe(false);
    expect(programmeStatus({ SHARED_LEARNING_ENABLED: "true" }, { ...published, privacyAssessmentRef: null, releaseCriteria: {} }).reasons.map((reason) => reason.code)).toEqual(["privacy_assessment_missing", "release_criteria_undefined"]);
    expect(programmeStatus({ SHARED_LEARNING_ENABLED: "true" }, published)).toMatchObject({ active: true, policyVersion: "2027-01" });
  });

  it("needs a current grant with every confirmation, a signed-off survey and no withdrawal", () => {
    const programme = programmeStatus({ SHARED_LEARNING_ENABLED: "true" }, published);
    const grant: ContributionGrant = { scope: "structured_cases", status: "granted", policyVersion: "2027-01", confirmations: ["client_information_authority", "third_party_rights", "policy_accepted"], createdAt: "2027-01-10T00:00:00Z" };
    const base = { programme, scope: "structured_cases" as const, grants: [grant], withdrawals: [], jobId: "job-1", survey: { status: "approved", signedOff: true, jurisdiction: "ENG" } };
    expect(evaluateEligibility(base)).toEqual({ eligible: true, reasons: [] });
    const codes = (input: Parameters<typeof evaluateEligibility>[0]) => evaluateEligibility(input).reasons.map((reason) => reason.code);
    expect(codes({ ...base, grants: [] })).toEqual(["scope_not_granted"]);
    expect(codes({ ...base, grants: [{ ...grant, confirmations: ["policy_accepted"] }] })).toEqual(["confirmations_missing"]);
    expect(codes({ ...base, grants: [grant, { ...grant, status: "revoked", createdAt: "2027-02-01T00:00:00Z" }] })).toEqual(["scope_not_granted"]);
    expect(codes({ ...base, grants: [{ ...grant, policyVersion: "2026-12" }] })).toEqual(["grant_policy_outdated"]);
    expect(codes({ ...base, withdrawals: [{ scope: null, jobId: "job-1", createdAt: "2027-01-01T00:00:00Z" }] })).toEqual(["job_withdrawn"]);
    expect(codes({ ...base, withdrawals: [{ scope: "structured_cases", jobId: null, createdAt: "2027-01-11T00:00:00Z" }] })).toEqual(["scope_withdrawn"]);
    expect(codes({ ...base, withdrawals: [{ scope: "photos", jobId: null, createdAt: "2027-01-11T00:00:00Z" }] })).toEqual([]);
    expect(codes({ ...base, survey: { status: "in_progress", signedOff: false, jurisdiction: "ENG" } })).toEqual(["survey_not_signed_off"]);
    expect(codes({ ...base, programme: programmeStatus({}, published) })).toEqual(["programme_inactive"]);
  });
});

describe("sanitiser", () => {
  it("removes identifiers and generalises dates", () => {
    const input = "Mrs Jane Doe at 14 Acacia Avenue, Bristol BS8 1AA (tel 07700 900123, jane.doe@example.com) said the roof was repaired on 12 March 2019 by Smith & Sons. See IMG_2041.jpg, https://example.com/x and job SVY-1048, UPRN 100023336956, at 51.4545, -2.5879, grid ST 58650 72830, certificate 0100-0001-0002-0003.";
    const { text, findings, residual } = scanText(input, known);
    for (const leaked of ["Jane", "Doe", "Acacia", "Bristol", "BS8", "07700", "example.com", "IMG_2041", "SVY-1048", "100023336956", "51.4545", "58650", "0100-0001"]) expect(text).not.toContain(leaked);
    expect(text).toContain("2019");
    expect(text).not.toMatch(/12 March/);
    expect(findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining(["titled_name", "known_address", "known_reference", "email", "url", "file_name", "phone", "long_number", "coordinates", "grid_reference", "reference", "date"]));
    expect(residual).toContain("Smith");
  });

  it("finds unknown names and addresses by pattern", () => {
    const { text } = scanText("Dr Alan Brown of 3 Mill Lane reported damp. Postcode LS6 2AB.", { names: [], addressParts: [], references: [] });
    expect(text).toBe("[name removed] of [address removed] reported damp. Postcode [postcode removed].");
    expect(containsIdentifiers("Slipped slates to the rear pitch.")).toBe(false);
    expect(containsIdentifiers("Contact 0117 496 0000 for access.")).toBe(true);
  });

  const source: ExtractionSource = {
    survey: { jurisdiction: "ENG", serviceLevel: "level_2", templateKey: "surveynt-residential", templateVersion: 1 },
    values: [
      { fieldPath: "about.property.property_type", value: { state: "provided", value: "house" } },
      { fieldPath: "about.property.built_form", value: { state: "provided", value: "mid_terrace" } },
      { fieldPath: "about.property.construction_period", value: { state: "provided", value: "1900_1929" } },
      { fieldPath: "about.property.year_built_estimate", value: { state: "provided", value: 1934 } },
      { fieldPath: "about.property.storeys", value: { state: "provided", value: 5 } },
      { fieldPath: "outside.roof_coverings.condition_rating", value: { state: "provided", value: "2" } },
      { fieldPath: "outside.roof_coverings.construction", value: { state: "provided", value: "Pitched roof with natural slate, inspected from 14 Acacia Avenue's garden." } },
      { fieldPath: "outside.chimney_stacks.condition_rating", value: { state: "unknown" } },
    ],
    elements: [
      { id: "e1", sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "Jane's extension", inspectionStatus: "inspected", limitationReason: null },
      { id: "e2", sectionKey: "outside", elementKey: "chimney_stacks", locationLabel: "", inspectionStatus: "inspected", limitationReason: null },
      { id: "e3", sectionKey: "inside", elementKey: "ceilings", locationLabel: "", inspectionStatus: "not_inspected", limitationReason: "Furniture" },
    ],
    observations: [
      { elementId: "e1", kind: "current_observation", text: "Several slipped slates to the rear pitch.", structured: { defect: { nextAction: "repair" } } },
      { elementId: "e1", kind: "client_claim", text: "Mrs Doe says the roof was replaced in 2015.", structured: null },
      { elementId: "e3", kind: "current_observation", text: "Not seen.", structured: null },
    ],
    photosByElement: { e1: 2 },
    elementLabels: { "outside.roof_coverings": "Roof coverings" },
  };

  it("extracts only rated or observed inspected elements, minimally", () => {
    const candidates = extractCandidates(source);
    expect(candidates.map((item) => item.elementRef)).toEqual(["outside.roof_coverings"]);
    expect(Object.keys(candidates[0].content)).toEqual(["jurisdiction", "serviceLevel", "template", "property", "element", "observations", "photoCount"]);
    expect(extractCandidates({ ...source, survey: { ...source.survey, jurisdiction: null } })).toEqual([]);
  });

  it("generalises context, drops location labels and flags what needs people", () => {
    const [candidate] = extractCandidates(source);
    const result = sanitiseCandidate(candidate.content, known);
    expect(result.case.property).toEqual({ propertyType: "house", builtForm: "mid_terrace", ageBand: "1919_1944", storeys: "4 or more" });
    expect(JSON.stringify(result.case)).not.toMatch(/Jane|Acacia|extension|1934/);
    expect(result.case.text.clientStatements).toEqual(["[name removed] says the roof was replaced in 2015."]);
    expect(result.case.nextActions).toEqual(["repair"]);
    expect(result.flags).toEqual(expect.arrayContaining(["free_text_requires_rewrite", "photo_manual_review_required", "client_statement_unverified"]));
    expect(result.findings).toEqual(expect.arrayContaining([{ field: "location", kind: "dropped", count: 1 }, { field: "property.yearBuilt", kind: "generalised_to_age_band", count: 1 }]));
    expect(result.quasiKey).toBe("ENG|house|mid_terrace|1919_1944|4 or more|outside.roof_coverings|2");
  });

  it("generalises rare combinations further and quarantines them if still rare", () => {
    const [candidate] = extractCandidates(source);
    const result = sanitiseCandidate(candidate.content, known);
    expect(applyRarityCheck(result, () => 10, 3)).toMatchObject({ quarantined: false, quasiKey: result.quasiKey });
    const generalised = applyRarityCheck(result, (key) => (key.includes("mid_terrace") ? 1 : 5), 3);
    expect(generalised).toMatchObject({ quarantined: false, flags: expect.arrayContaining(["generalised_for_rarity"]) });
    expect(generalised.case.property).toMatchObject({ builtForm: null, storeys: null });
    expect(applyRarityCheck(result, () => 0, 3)).toMatchObject({ quarantined: true, flags: expect.arrayContaining(["rare_combination"]) });
  });
});

describe("review", () => {
  const reviewed = { observedFeature: "Several slipped and missing slates to a rear roof pitch.", possibleCauses: ["Nail fatigue"], confirmedCause: null, confirmationBasis: null, surveyorJudgement: "Repairs needed soon but not urgent; no internal staining seen.", ratingExample: "2" as const, nextSteps: ["Roofer to refix slates"], limitations: null, uncertainty: "medium" as const, evidenceStrength: "observed" as const, knowledgeReviewDue: "2029-01-01", ratingDisagreement: false, noDefect: false };

  it("requires every privacy check to approve and a reason to reject", () => {
    expect(privacyDecisionSchema.safeParse({ decision: "approved", checks: ["identifiers_removed"] }).success).toBe(false);
    expect(privacyDecisionSchema.safeParse({ decision: "rejected", checks: [] }).success).toBe(false);
    expect(privacyDecisionSchema.safeParse({ decision: "rejected", checks: [], note: "Unique narrative." }).success).toBe(true);
  });

  it("keeps confirmed causes separate and refuses a client's account as confirmation", () => {
    expect(reviewedCaseSchema.safeParse(reviewed).success).toBe(true);
    expect(reviewedCaseSchema.safeParse({ ...reviewed, confirmedCause: "Corroded nails", confirmationBasis: null }).success).toBe(false);
    expect(technicalDecisionSchema.safeParse({ decision: "approved", reviewed: null }).success).toBe(false);
  });

  it("re-scans reviewer text for identifiers", () => {
    expect(reviewedCaseProblems(reviewed)).toEqual([]);
    expect(reviewedCaseProblems({ ...reviewed, nextSteps: ["Call 07700 900123"] })).toEqual(["nextSteps.0"]);
  });
});

describe("curation and release", () => {
  const item = (id: string, contributor: string, overrides: Partial<CurationItem> = {}): CurationItem => ({ candidateId: id, contributorKey: contributor, dedupKey: `p-${id}|roof`, groupKey: `p-${id}`, reviewedAt: "2027-02-01", coverage: { jurisdiction: "ENG", elementKey: "outside.roof_coverings" }, uncertainty: "low", ratingDisagreement: false, noDefect: false, ...overrides });

  it("caps dominant contributors by weight", () => {
    const weights = contributorWeights(new Map([["big", 8], ["a", 1], ["b", 1], ["c", 1]]), 0.4)!;
    const effective = 8 * weights.get("big")!;
    expect(effective / (effective + 3)).toBeCloseTo(0.4, 5);
    expect(weights.get("a")).toBe(1);
    expect(contributorWeights(new Map([["a", 5], ["b", 5]]), 0.4)).toBeNull();
  });

  it("deduplicates, reports coverage gaps and blocks releases that break the criteria", () => {
    const items = [item("1", "big"), item("2", "big"), item("3", "big"), item("4", "big", { dedupKey: "p-3|roof", reviewedAt: "2027-01-01" }), item("5", "a", { coverage: { jurisdiction: "WLS", elementKey: "outside.roof_coverings" }, noDefect: true }), item("6", "b", { ratingDisagreement: true }), item("7", "c")];
    const result = curateRelease(items, criteria, { jurisdiction: ["ENG", "WLS", "SCT", "NIR"] });
    expect(result.excluded).toEqual([{ candidateId: "4", reason: "duplicate" }]);
    expect(result.manifest).toMatchObject({ caseCount: 6, contributorCount: 4, maxRawShare: 0.5, capFeasible: true, unsupportedSegments: ["jurisdiction=SCT", "jurisdiction=NIR"], noDefectCases: 1, disagreementCases: 1 });
    expect(result.manifest.maxEffectiveShare).toBeLessThanOrEqual(0.4);
    const states = result.included.map(({ candidateId }) => ({ candidateId, privacyApproved: true, technicalApproved: true, rightsCurrent: candidateId !== "7", withdrawn: false }));
    expect(releaseProblems(result, criteria, states, { technicalAgreement: null })).toEqual(["Case 7 no longer has a current contribution grant."]);
    expect(releaseProblems(curateRelease(items.slice(0, 2), criteria), criteria, [], { technicalAgreement: null })).toEqual(expect.arrayContaining([expect.stringMatching(/at least 3/), expect.stringMatching(/Too few contributors/)]));
  });
});

describe("evaluation splits and training gate", () => {
  it("keeps properties and held-out contributors on one side", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({ candidateId: `c${index}`, contributorKey: `f${index % 5}`, groupKey: `p${Math.floor(index / 2)}`, reviewedAt: index > 35 ? "2027-06-01" : "2027-01-01" }));
    const assignments = planEvaluationSplits(items, { heldOutContributors: ["f4"], testFromDate: "2027-05-01", testShare: 0.2, seed: "s" });
    expect(splitLeakage(items, assignments, ["f4"])).toEqual({ groups: [], contributors: [] });
    expect(assignments.filter((item) => item.reason === "later_date" || item.reason === "held_out_contributor").every((item) => item.split === "test")).toBe(true);
    expect(assignments.some((item) => item.split === "train")).toBe(true);
  });

  it("never treats unreleased, withdrawn or ungranted cases as trainable, and keeps fine-tuning gated", () => {
    expect(trainingEligibility({ status: "released", releasedIn: "2027.1", modelTrainingGrant: { status: "granted", policyVersion: "v1" }, currentPolicyVersion: "v1" }).eligible).toBe(true);
    expect(trainingEligibility({ status: "withdrawn", releasedIn: "2027.1", modelTrainingGrant: { status: "granted", policyVersion: "v1" }, currentPolicyVersion: "v1" }).reasons).toEqual(["withdrawn"]);
    expect(trainingEligibility({ status: "released", releasedIn: "2027.1", modelTrainingGrant: null, currentPolicyVersion: "v1" }).reasons).toEqual(["no_model_training_grant"]);
    const gate = fineTuningGate({ providerRegistered: false, retrievalBaselineEvaluated: false, specificFailuresIdentified: false, measuredBenefitOverBaseline: false, memorisationAndLeakageTestsPassed: false, retirementAndRetrainingProcedureApproved: false, eligibleCases: 0, minimumEligibleCases: null });
    expect(gate).toMatchObject({ allowed: false });
    expect(gate.reasons).toHaveLength(7);
  });
});

describe("photo controls", () => {
  it("strips EXIF including GPS and can crop", async () => {
    const original = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } })
      .withExif({ IFD0: { Make: "TestCam", ImageDescription: "14 Acacia Avenue" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 27/1 0/1" } })
      .jpeg().toBuffer();
    expect((await sharp(original).metadata()).exif).toBeTruthy();
    const stripped = await stripImageMetadata(original, { left: 8, top: 8, width: 32, height: 24 });
    expect(stripped).toMatchObject({ width: 32, height: 24, removed: { exif: true }, remaining: { exif: false, xmp: false, iptc: false }, reviewRequired: true });
    expect(stripped.buffer.includes(Buffer.from("Acacia"))).toBe(false);
  });
});
