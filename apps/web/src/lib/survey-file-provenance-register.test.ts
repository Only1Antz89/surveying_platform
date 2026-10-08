import { expect, it } from "vitest";
import type { TenantTransaction } from "@surveynt/db";
import { readSurveyFileProvenance } from "./survey-file-provenance-register";
function transaction(change: Record<string, unknown> = {}) {
  const rows = [[{ id: "survey" }], [{ id: "task", surveyId: "survey", title: "private title", detail: "private detail", resolutionNote: "private resolution", evidence: {}, ...change }], [{ id: "proposal", surveyId: "survey", proposedValue: { text: "private value" }, limitations: ["private limitation"], reviewNote: "private review", evidenceRefs: [], ...change }]];
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
