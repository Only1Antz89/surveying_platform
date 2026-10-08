import { expect, it } from "vitest";
import type { TenantTransaction } from "@surveynt/db";
import { readSurveyFileProvenance } from "./survey-file-provenance-register";
function transaction(change: Record<string, unknown> = {}, recordedCollection?: "values" | "observations" | "elements") {
  const rows = [[{ id: "survey" }], [{ id: "element", surveyId: "survey", locationLabel: "private element location", limitationReason: "private inspection limitation", inspectionStatus: "not_inspected", ...(recordedCollection === "elements" ? change : {}) }], [{ id: "value", surveyId: "survey", value: { text: "private answer" }, sourceRef: "private source", correctionReason: "private correction", ...(recordedCollection === "values" ? change : {}) }], [{ id: "observation", surveyId: "survey", text: "private observation", structured: { text: "private context" }, locationLabel: "private location", sourceRef: "private source", ...(recordedCollection === "observations" ? change : {}) }], [{ id: "task", surveyId: "survey", title: "private title", detail: "private detail", resolutionNote: "private resolution", evidence: {}, ...change }], [{ id: "proposal", surveyId: "survey", proposedValue: { text: "private value" }, limitations: ["private limitation"], reviewNote: "private review", evidenceRefs: [], ...change }]];
  return { select: () => { const result = rows.shift(); const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => result }; return chain; } } as unknown as TenantTransaction;
}
it.each([
  ["title", "private changed", "tasks"],
  ["detail", "private changed", "tasks"],
  ["resolutionNote", "private changed", "tasks"],
  ["proposedValue", { text: "private changed" }, "proposals"],
  ["limitations", ["private changed"], "proposals"],
  ["reviewNote", "private changed", "proposals"],
] as const)("binds %s to the review fingerprint without exposing content", async (field, value, collection) => {
  const first = await readSurveyFileProvenance(transaction(), "org", "job", [], []);
  const second = await readSurveyFileProvenance(transaction({ [field]: value }), "org", "job", [], []);
  expect(first[collection][0].contentFingerprint).not.toBe(second[collection][0].contentFingerprint);
  expect(first[collection][0].evidenceFingerprint).toBe(second[collection][0].evidenceFingerprint);
  expect(JSON.stringify(first)).not.toContain("private");
  expect(first.referenceReviewRequired).toBe(false);
});

it.each([
  ["locationLabel", "private changed", "elements"],
  ["limitationReason", "private changed", "elements"],
  ["inspectionStatus", "inspected", "elements"],
  ["value", { text: "private changed" }, "values"],
  ["sourceRef", "private changed", "values"],
  ["correctionReason", "private changed", "values"],
  ["text", "private changed", "observations"],
  ["structured", { text: "private changed" }, "observations"],
  ["locationLabel", "private changed", "observations"],
  ["sourceRef", "private changed", "observations"],
] as const)("binds recorded %s in %s without exposing its payload", async (field, value, collection) => {
  const first=await readSurveyFileProvenance(transaction(),"org","job",[],[]);
  const second=await readSurveyFileProvenance(transaction({[field]:value},collection),"org","job",[],[]);
  expect(first[collection][0].contentFingerprint).not.toBe(second[collection][0].contentFingerprint);
  expect(JSON.stringify(first)).not.toContain("private");
  expect(first.referenceReviewRequired).toBe(false);
});
