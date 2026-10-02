import { describe, expect, it } from "vitest";
import { analyseDocument, extractPdfText } from "./pdf-text";
import { analysePhoto } from "./photo-quality";
import { syntheticImages } from "./testing/images";
import { makeImageOnlyPdf, makeTextPdf } from "./testing/pdf";

describe("photo quality", () => {
  it("flags blur, darkness, overexposure and low resolution on synthetic images", async () => {
    const results = Object.fromEntries(await Promise.all(Object.entries(syntheticImages).map(async ([name, make]) => [name, await analysePhoto(await make())] as const)));
    const flags = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.status === "completed" ? result.flags : result.status]));
    expect(flags).toEqual({ sharp: [], blurred: ["possibly_blurred"], dark: ["too_dark"], overexposed: ["overexposed"], small: ["low_resolution"], stainedWall: [] });
    expect(results.sharp).toMatchObject({ status: "completed", width: 1600, height: 1200, format: "jpeg" });
  });

  it("reports an unreadable image as unavailable rather than failing", async () => {
    expect(await analysePhoto(new TextEncoder().encode("not an image"))).toMatchObject({ status: "unavailable" });
  });
});

describe("document text", () => {
  it("reads the text layer per page and finds certificate facts with page references", async () => {
    const pdf = makeTextPdf([["ELECTRICAL INSTALLATION CONDITION REPORT", "Report reference: EICR-2019-00417", "Date of inspection: 14/02/2019"], ["Next inspection due: 14 February 2024"]]);
    const text = await extractPdfText(pdf);
    expect(text).toMatchObject({ pageCount: 2, hasTextLayer: true, truncated: false });
    expect(text.pages[1]).toBe("Next inspection due: 14 February 2024");
    const analysis = await analyseDocument(pdf, { asOf: "2026-09-28" });
    expect(analysis).toMatchObject({ status: "completed", facts: { documentType: { value: "eicr" }, dueDate: { value: "2024-02-14", span: { page: 2 } }, reference: { value: "EICR-2019-00417" } }, checks: [{ code: "expired" }] });
  });

  it("reports scanned and unreadable PDFs as unavailable, and limits pages", async () => {
    expect(await analyseDocument(makeImageOnlyPdf(), { asOf: "2026-09-28" })).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/OCR/) });
    expect(await analyseDocument(new TextEncoder().encode("%PDF-1.4 broken"), { asOf: "2026-09-28" })).toMatchObject({ status: "unavailable", pageCount: null });
    const long = makeTextPdf(Array.from({ length: 5 }, (_, index) => [`Gas Safety Record page ${index + 1} with enough text to count`]));
    expect(await analyseDocument(long, { asOf: "2026-09-28", maxPages: 2 })).toMatchObject({ status: "completed", truncated: true, facts: { limitations: expect.arrayContaining(["Only the first 2 of 5 pages were read."]) } });
  });
});
