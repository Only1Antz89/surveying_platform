import { describe, expect, it } from "vitest";
import { residentialTemplateV1 } from "../forms/residential-v1";
import { composeReport, composerInputFingerprint, unknownPlaceholders, type ComposerInput, type WordingClause } from "./composer";

const clause = (overrides: Partial<WordingClause>): WordingClause => ({ id: overrides.clauseKey ?? "c", clauseKey: "c", version: 1, status: "approved", purpose: "element_narrative", title: "Clause", body: "Body.", elementKey: null, conditionRatings: [], nextActions: [], inspectionStatuses: [], jurisdictions: [], serviceLevels: [], ...overrides });

// Synthetic survey records; the wording is invented for the test.
function input(): ComposerInput {
  return {
    template: residentialTemplateV1, serviceLevel: "level_2", jurisdiction: "ENG", job: { reference: "J-1" }, property: { line1: "1 Test Road", city: "Bristol", postcode: "BS1 1AA" },
    values: [
      { id: "v1", fieldPath: "about.property.property_type", value: { state: "provided", value: "house" } },
      { id: "v2", fieldPath: "about.property.extensions_present", value: { state: "provided", value: false } },
      { id: "v3", fieldPath: "outside.roof_coverings.condition_rating", value: { state: "provided", value: "3" } },
      { id: "v4", fieldPath: "outside.roof_coverings.commentary", value: { state: "provided", value: "Several slates have slipped on the rear slope." } },
      { id: "v5", fieldPath: "outside.chimneys.condition_rating", value: { state: "provided", value: "NI" } },
      { id: "v6", fieldPath: "summary.opinion.overall_opinion", value: { state: "provided", value: "A reasonable purchase subject to the roof repairs." } },
    ],
    elements: [
      { id: "e1", sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "", inspectionStatus: "inspected", limitationReason: null },
      { id: "e1b", sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "Rear slope", inspectionStatus: null, limitationReason: null },
      { id: "e2", sectionKey: "outside", elementKey: "chimneys", locationLabel: "", inspectionStatus: "inaccessible", limitationReason: "No safe view from the ground or neighbouring land." },
      { id: "e3", sectionKey: "outside", elementKey: "windows", locationLabel: "", inspectionStatus: "not_applicable", limitationReason: null },
    ],
    observations: [
      { id: "o1", elementId: "e1b", kind: "current_observation", text: "Four slipped slates.", locationLabel: "Rear slope", structured: { defect: { nextAction: "repair" } }, version: 1 },
      { id: "o2", elementId: "e1", kind: "client_claim", text: "The roof was overhauled in 2015.", locationLabel: null, structured: {}, version: 1 },
      { id: "o3", elementId: "e2", kind: "current_observation", text: "Should never appear: chimney not inspected.", locationLabel: null, structured: {}, version: 1 },
    ],
    evidence: [{ targetType: "observation", targetId: "o1", evidenceType: "media", evidenceId: "m1" }, { targetType: "element", targetId: "e1", evidenceType: "media", evidenceId: "m2" }],
    media: [{ id: "m1", kind: "photo" }, { id: "m2", kind: "photo" }],
    clauses: [
      clause({ id: "k1", clauseKey: "roof.serious", elementKey: "outside.roof_coverings", conditionRatings: ["3"], body: "Repairs to the {element} should be carried out promptly." }),
      clause({ id: "k2", clauseKey: "rec.repair", purpose: "recommendation", nextActions: ["repair"], body: "Obtain quotations to {next_action} the {location}." }),
      clause({ id: "k3", clauseKey: "lim.inaccessible", purpose: "limitation", inspectionStatuses: ["inaccessible"], body: "We could not see the {element}; ask a contractor to check it." }),
      clause({ id: "k4", clauseKey: "draft.only", status: "draft", body: "DRAFT WORDING MUST NOT APPEAR." }),
      clause({ id: "k5", clauseKey: "retired.only", status: "retired", body: "RETIRED WORDING MUST NOT APPEAR." }),
      clause({ id: "k6", clauseKey: "needs.location", elementKey: "outside.roof_coverings", body: "Seen at {location}." }),
      clause({ id: "k7", clauseKey: "summary.serious", purpose: "summary", conditionRatings: ["3"], body: "Some elements are rated {rating}; act before exchange." }),
      clause({ id: "k8", clauseKey: "summary.scotland", purpose: "summary", jurisdictions: ["SCT"], body: "SCOTTISH WORDING MUST NOT APPEAR." }),
    ],
  };
}

const texts = (report: ReturnType<typeof composeReport>["report"]) => JSON.stringify(report);

describe("deterministic report composer", () => {
  it("uses only recorded values, current observations and approved, matching clauses", () => {
    const { report, trace } = composeReport(input());
    const roof = report.sections.find((section) => section.key === "outside")!.elements.find((element) => element.key === "outside.roof_coverings")!;
    expect(roof.blocks.map((block) => block.kind)).toEqual(["rating", "paragraph", "observation", "client_statement", "clause", "photos"]);
    expect(roof.blocks[2].text).toBe("Observed (Rear slope): Four slipped slates.");
    expect(roof.blocks[3].text).toMatch(/^The client reported: “The roof was overhauled in 2015\.” This was not verified/);
    expect(roof.blocks[4].text).toBe("Repairs to the roof coverings should be carried out promptly.");
    expect(report.recommendations.map((block) => block.text)).toEqual(["Roof coverings (Rear slope): Repair.", "Obtain quotations to repair the Rear slope."]);
    expect(texts(report)).not.toMatch(/MUST NOT APPEAR/);
    expect(trace.clauses.map((item) => item.clauseKey)).toEqual(["lim.inaccessible", "rec.repair", "roof.serious", "summary.serious"]);
    expect(trace.media).toEqual(["m1", "m2"]);
  });

  it("gives uninspected elements limitation text only, and skips not-applicable ones", () => {
    const { report } = composeReport(input());
    const outside = report.sections.find((section) => section.key === "outside")!;
    const chimneys = outside.elements.find((element) => element.key === "outside.chimneys")!;
    expect(chimneys.blocks.map((block) => block.text)).toEqual(["Inaccessible. No safe view from the ground or neighbouring land.", "We could not see the chimney stacks; ask a contractor to check it."]);
    expect(texts(report)).not.toMatch(/Should never appear/);
    expect(outside.elements.some((element) => element.key === "outside.windows")).toBe(false);
    expect(report.ratingSummary.map((group) => [group.rating, group.elements.map((element) => element.key)])).toEqual([["3", ["outside.roof_coverings"]], ["NI", ["outside.chimneys"]]]);
  });

  it("traces every block to its records and reports what it left out", () => {
    const { report } = composeReport(input());
    const blocks = [...report.sections.flatMap((section) => [...section.blocks, ...section.elements.flatMap((element) => element.blocks)]), ...report.recommendations];
    expect(blocks.every((block) => block.sources.length > 0)).toBe(true);
    expect(report.sections.find((section) => section.key === "summary")!.blocks.map((block) => block.text)).toEqual(["Overall opinion: A reasonable purchase subject to the roof repairs.", "Some elements are rated 3; act before exchange."]);
    expect(report.omissions.some((item) => item.includes("needs.location"))).toBe(true);
    expect(report.omissions.some((item) => item.startsWith("Main walls: no inspection status"))).toBe(true);
  });

  it("is deterministic, and its fingerprint changes with any input", async () => {
    expect(composeReport(input())).toEqual(composeReport(input()));
    const base = await composerInputFingerprint(input());
    expect(await composerInputFingerprint(input())).toBe(base);
    const edited = input();
    edited.observations[0] = { ...edited.observations[0], text: "Five slipped slates.", version: 2 };
    expect(await composerInputFingerprint(edited)).not.toBe(base);
    const newClause = input();
    newClause.clauses[3] = { ...newClause.clauses[3], status: "approved" };
    expect(await composerInputFingerprint(newClause)).not.toBe(base);
  });

  it("refuses unknown placeholders", () => {
    expect(unknownPlaceholders("The {element} at {location} needs {cost}.")).toEqual(["cost"]);
  });
});
