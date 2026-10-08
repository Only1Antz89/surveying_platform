import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SurveyPack } from "@/lib/surveys";
import { AssistantPanel } from "./assistant-panel";
it("renders removed proposal content without value parsing or review controls", () => {
  const pack = { assistantEnabled: true, tasks: [], proposals: [{ id: "removed", fieldPath: "matters.legal.guarantees", proposedValue: { retentionRemoved: true } }] } as unknown as SurveyPack;
  const html = renderToStaticMarkup(createElement(AssistantPanel, { surveyId: "survey", pack, fieldPath: "matters.legal.guarantees", canEdit: true, canJudge: true, online: true, onChanged: async () => undefined }));
  expect(html).toContain("Proposal content removed after retention review");
  expect(html).not.toContain("Suggested:"); expect(html).not.toContain(">Accept<"); expect(html).not.toContain(">Edit<");
});
it("does not offer resolution controls for removed task content", () => {
  const pack = { assistantEnabled: true, proposals: [], tasks: [{ id: "removed-task", kind: "discrepancy", status: "open", fieldPath: "matters.legal.guarantees", title: "Content removed after retention review", detail: null, evidence: { retentionRemoved: true } }] } as unknown as SurveyPack;
  const html = renderToStaticMarkup(createElement(AssistantPanel, { surveyId: "survey", pack, fieldPath: "matters.legal.guarantees", canEdit: true, canJudge: true, online: true, onChanged: async () => undefined }));
  expect(html).toContain("Content removed after retention review");
  expect(html).not.toContain("Mark resolved"); expect(html).not.toContain(">Dismiss<");
});
