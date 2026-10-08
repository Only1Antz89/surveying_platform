import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { residentialTemplateV1, type FieldDefinition } from "@surveynt/assistant";
import { SurveyField } from "./survey-field";
it("labels removed answers without editable or evidence controls", () => {
  const html = renderToStaticMarkup(createElement(SurveyField, {
    field: { key: "answer", label: "Recorded answer", type: "text", requirement: "optional" } as FieldDefinition,
    path: "fixture.retained.answer", template: residentialTemplateV1,
    display: { value: null, pending: false, origin: "surveyor_entry", contentRemoved: true },
    disabled: false, lockedReason: null, onSave: () => undefined,
  }));
  expect(html).toContain("Answer content removed after retention review");
  expect(html).not.toContain("<input"); expect(html).not.toContain("<select"); expect(html).not.toContain("<textarea");
});
