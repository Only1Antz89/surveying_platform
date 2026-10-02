import { getDocumentProxy } from "unpdf";
import { certificateChecks, findCertificateFacts, type CertificateCheck, type CertificateFacts } from "@surveynt/assistant";

export type PdfText = { pageCount: number; pages: string[]; hasTextLayer: boolean; truncated: boolean };

/**
 * Reads the text layer of a PDF, page by page, with a page limit. Only text is
 * read: no rendering, fonts or scripts, and no OCR is attempted.
 */
export async function extractPdfText(input: Uint8Array, options: { maxPages?: number } = {}): Promise<PdfText> {
  const pdf = await getDocumentProxy(new Uint8Array(input), { disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 });
  try {
    const limit = Math.min(pdf.numPages, options.maxPages ?? 30);
    const pages: string[] = [];
    for (let number = 1; number <= limit; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5] as number;
        if (lastY !== null && Math.abs(y - lastY) > 1 && !text.endsWith("\n")) text += "\n";
        text += item.str;
        if (item.hasEOL && !text.endsWith("\n")) text += "\n";
        lastY = y;
      }
      pages.push(text.trim());
    }
    const characters = pages.join("").replace(/\s/g, "").length;
    return { pageCount: pdf.numPages, pages, hasTextLayer: characters >= 20, truncated: pdf.numPages > limit };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export type DocumentAnalysis =
  | { status: "completed"; pageCount: number; truncated: boolean; facts: CertificateFacts; checks: CertificateCheck[] }
  | { status: "unavailable"; reason: string; pageCount: number | null };

/** Certificate facts and validity checks for a PDF; scanned pages without text report OCR as unavailable. */
export async function analyseDocument(input: Uint8Array, options: { asOf: string; maxPages?: number }): Promise<DocumentAnalysis> {
  let text: PdfText;
  try {
    text = await extractPdfText(input, options);
  } catch {
    return { status: "unavailable", reason: "The PDF could not be read. It may be damaged or password protected.", pageCount: null };
  }
  if (!text.hasTextLayer) return { status: "unavailable", reason: "No text layer was found. Scanned documents need OCR, which is not available.", pageCount: text.pageCount };
  const facts = findCertificateFacts(text.pages);
  if (text.truncated) facts.limitations.push(`Only the first ${text.pages.length} of ${text.pageCount} pages were read.`);
  return { status: "completed", pageCount: text.pageCount, truncated: text.truncated, facts, checks: certificateChecks(facts, options.asOf) };
}
