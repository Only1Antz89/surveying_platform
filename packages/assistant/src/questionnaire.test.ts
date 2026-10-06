import { describe, expect, it } from "vitest";
import { preinspectionAnswersSchema } from "./questionnaire";
import { homeSurveyTemplatesV1_2 } from "./forms/home-survey-v1_2";
import { generateSourcedProposals } from "./proposals/sourced";

describe("customer questionnaire contract and evidence", () => {
  it("offers only confirmed document completion dates with explicit page/excerpt provenance", async () => {
    const input = { template: homeSurveyTemplatesV1_2[1], job: { id: "job", reference: "DEMO", targetDate: null }, currentValues: new Map(), snapshots: [] };
    const result = await generateSourcedProposals({ ...input, documents: [{ id: "document", name: "Completion certificate", context: "checksum|property|association", worksKind: "extension", completionDate: "2020-06-15", page: 2, excerpt: "Works completion date: 15/06/2020" }] });
    expect(result.proposals.find(proposal => proposal.fieldPath === "c.details.extended_year")).toMatchObject({ originClass: "document_extraction", proposedValue: { state: "provided", value: "Document states: 2020" }, evidenceRefs: [{ type: "document_span", context: "checksum|property|association", label: expect.stringContaining("page 2") }] });
    expect((await generateSourcedProposals(input)).proposals.some(proposal => proposal.fieldPath === "c.details.extended_year")).toBe(false);
  });
  it("offers reusable identity only in the new template without completing qualifications or signatures", async () => {
    const result = await generateSourcedProposals({ template: homeSurveyTemplatesV1_2[1], job: { id: "job", reference: "DEMO", targetDate: null }, currentValues: new Map(), snapshots: [], identity: { practitioner: { id: "self", name: "Demo Surveyor", ricsNumber: "123456", fingerprint: "personal-version" }, firm: { id: "firm", companyName: "Demo Practice", address: "Report office", email: "practice@example.test", fingerprint: "firm-version" } } });
    const name = result.proposals.find(proposal => proposal.fieldPath === "a.details.surveyor_name");
    expect(name).toMatchObject({ originClass: "practice_record", evidenceRefs: [{ type: "practitioner_profile", id: "self", context: "personal-version" }] });
    expect(result.proposals.some(proposal => /qualification|signature|declaration_date/.test(proposal.fieldPath))).toBe(false);
    expect(result.proposals.find(proposal => proposal.fieldPath === "declaration.details.company_address")?.proposedValue).toEqual({ state: "provided", value: "Report office" });
  });
  it("allows optional unknowns but never accepts professional findings or oversized statements", () => {
    expect(preinspectionAnswersSchema.safeParse({}).success).toBe(true);
    expect(preinspectionAnswersSchema.safeParse({ conditionRating: "1" }).success).toBe(false);
    expect(preinspectionAnswersSchema.safeParse({ concerns: "x".repeat(2001) }).success).toBe(false);
    expect(preinspectionAnswersSchema.safeParse({ extensionCompletionYear: 99 }).success).toBe(false);
  });
  it("keeps conflicting client and certificate statements separately reviewable without auto-selecting one", async () => {
    const result = await generateSourcedProposals({ template: homeSurveyTemplatesV1_2[1], job: { id: "job", reference: "DEMO", targetDate: null }, currentValues: new Map(), questionnaire: { id: "submission", version: 1, submittedAt: "2026-10-04", propertyFingerprint: "confirmed-identity", answers: { propertyType: "Bungalow", occupancy: "Vacant", extensionCompletionYear: 2020 } }, snapshots: [{ snapshotId: "epc", category: "energy_certificate", sourceKey: "epc_england_wales", status: "matched", retrievedAt: "2026-10-04", sourceUpdatedAt: null, sourceRecordId: "certificate", data: { latest: true, propertyType: "House", extensionPermissionDate: "2019-01-01" } }] });
    const types = result.proposals.filter(p => p.fieldPath === "c.details.property_type");
    expect(types).toHaveLength(2);
    expect(new Set(types.map(p => p.originClass))).toEqual(new Set(["customer_statement", "external_record"]));
    expect(types.find(p => p.originClass === "customer_statement")?.evidenceRefs[0]).toMatchObject({ type: "customer_submission", id: "submission", context: "confirmed-identity" });
    expect(result.proposals.find(p => p.fieldPath === "c.details.extended_year")?.proposedValue).toEqual({ state: "provided", value: "Client reports: 2020" });
    expect(result.proposals.some(p => p.fieldPath === "a.details.property_status")).toBe(false);
  });
});
