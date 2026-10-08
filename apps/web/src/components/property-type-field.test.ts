import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertyTypeField } from "./property-type-field";
import { propertyTypeOptions } from "../lib/property-artwork";

describe("property type form suggestions", () => {
  it("offers every mapped type with a labelled, described native input", () => {
    const html = renderToStaticMarkup(createElement(PropertyTypeField, { id: "new-type" }));
    expect(html).toContain('name="propertyType"');
    expect(html).toContain('list="new-type-options"');
    expect(html).toContain('aria-describedby="new-type-help"');
    for (const option of propertyTypeOptions) expect(html).toContain(`value="${option.label}"`);
  });
  it("preserves a custom existing description and uses independent input/list IDs", () => {
    const html = renderToStaticMarkup(createElement(PropertyTypeField, { id: "edit-type", defaultValue: "Historic converted coach house" }));
    expect(html).toContain('value="Historic converted coach house"');
    expect(html).toContain('list="edit-type-options"');
    expect(html).not.toContain("new-type-options");
  });
});
