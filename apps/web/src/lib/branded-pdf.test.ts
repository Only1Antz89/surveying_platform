import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { BrandedDocument, money } from "./branded-pdf";

const brand = { name: "Example Surveyors Ltd", accent: "#1d4ed8", address: "1 High Street, Bristol", email: "office@example.test", phone: "0117 000 0000" };

describe("branded practice documents", () => {
  it("paginates long content, numbers pages and records the document title", async () => {
    const pdf = await BrandedDocument.create(brand, "Quote Q-1", { watermark: "REVIEW COPY" });
    pdf.heading("Quote Q-1", 1).details([["Prepared for", "A Client"], ["Property", "2 Long Road, Bath"]]);
    for (let index = 0; index < 60; index++) pdf.paragraph(`Clause ${index + 1}. ${"The surveyor inspects what is visible and accessible on the day. ".repeat(4)}`);
    pdf.table([{ label: "Room", width: 2 }, { label: "Area", width: 1, align: "right" }], Array.from({ length: 80 }, (_, index) => ({ cells: [`Room ${index}`, `${index} m²`] })));
    const bytes = await pdf.finish("Example Surveyors · Q-1");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(3);
    expect(loaded.getTitle()).toBe("Quote Q-1");
    expect(loaded.getAuthor()).toBe("Example Surveyors Ltd");
  });
  it("replaces characters the standard fonts cannot encode instead of failing", async () => {
    const pdf = await BrandedDocument.create({ ...brand, accent: "not-a-colour" }, "Letter");
    pdf.paragraph("Readings ≥ 20% — damp “noted” in the 2×3 m room ✓ and a verylongunbrokenwordthatmustwrapacrossthepagewithoutoverflowingtheprintablewidthatall");
    await expect(pdf.finish("Letter")).resolves.toBeInstanceOf(Uint8Array);
  });
  it("formats money in pounds", () => { expect(money(123456)).toBe("£1,234.56"); });
});
