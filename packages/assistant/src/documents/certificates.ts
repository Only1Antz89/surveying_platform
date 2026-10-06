// Deterministic facts from the text layer of a certificate or guarantee. Every
// fact carries the page and character span it came from. Nothing is inferred:
// a date that is ambiguous (for example a two-digit year) is not extracted, and
// instruction-like text in a document is reported, never followed.

export const CERTIFICATE_EXTRACTOR = "certificate-facts-v2";

export const certificateTypes = ["eicr", "electrical_installation_certificate", "gas_safety_record", "energy_performance_certificate", "fensa", "building_regulations_completion", "guarantee"] as const;
export type CertificateType = (typeof certificateTypes)[number];

export const certificateTypeLabels: Record<CertificateType, string> = {
  eicr: "Electrical installation condition report",
  electrical_installation_certificate: "Electrical installation certificate",
  gas_safety_record: "Gas safety record",
  energy_performance_certificate: "Energy performance certificate",
  fensa: "FENSA certificate",
  building_regulations_completion: "Building regulations completion certificate",
  guarantee: "Guarantee or warranty",
};

export type DocumentSpan = { page: number; start: number; end: number; excerpt: string };
export type Fact<T> = { value: T; span: DocumentSpan };

export type CertificateFacts = {
  extractor: typeof CERTIFICATE_EXTRACTOR | "certificate-facts-v1";
  documentType: Fact<CertificateType> | null;
  /** Other certificate types also named in the document; the type is then uncertain. */
  otherTypesMentioned: CertificateType[];
  issueDate: Fact<string> | null;
  /** Explicitly stated works-completion date; never a certificate issue or permission date. */
  worksCompletionDate?: Fact<string> | null;
  inspectionDate: Fact<string> | null;
  /** "Valid until", "expiry", "next inspection due" and similar. */
  dueDate: Fact<string> | null;
  reference: Fact<string> | null;
  /** The document contains text that reads like instructions to an AI system. It was treated as data. */
  instructionLikeText: DocumentSpan | null;
  limitations: string[];
};

const typePatterns: [CertificateType, RegExp][] = [
  ["eicr", /electrical installation condition report|\bEICR\b/i],
  ["electrical_installation_certificate", /electrical installation certificate/i],
  ["gas_safety_record", /gas safety (?:record|certificate)|landlord(?:'s)? gas safety|\bCP12\b/i],
  ["energy_performance_certificate", /energy performance certificate/i],
  ["fensa", /\bFENSA\b/i],
  ["building_regulations_completion", /completion certificate/i],
  ["guarantee", /\bguarantee\b|\bwarranty\b/i],
];

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const datePattern = String.raw`(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4})`;

/** Parses a UK day-first date. Two-digit years and impossible dates return null. */
export function parseDocumentDate(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  let day: number, month: number, year: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
  else if ((match = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(text))) {
    if (match[3].length !== 4) return null;
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{2,4})$/.exec(text))) {
    if (match[3].length !== 4) return null;
    const index = months.findIndex((name) => name.startsWith(match![2].slice(0, 3)));
    if (index < 0) return null;
    day = Number(match[1]); month = index + 1; year = Number(match[3]);
  } else return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function excerpt(text: string, start: number, end: number) {
  return text.slice(Math.max(0, start), Math.min(text.length, end)).replace(/\s+/g, " ").trim().slice(0, 200);
}

function findLabelled(pages: string[], label: RegExp, value: string, parse: (raw: string) => string | null): { fact: Fact<string> | null; rejected: boolean } {
  let rejected = false;
  const pattern = new RegExp(`(?:${label.source})\\s*[:\\-–#]?\\s*${value}`, "gi");
  for (const [index, text] of pages.entries()) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[match.length - 1];
      const parsed = parse(raw);
      if (!parsed) { rejected = true; continue; }
      const start = match.index ?? 0;
      return { fact: { value: parsed, span: { page: index + 1, start, end: start + match[0].length, excerpt: excerpt(text, start, start + match[0].length) } }, rejected };
    }
  }
  return { fact: null, rejected };
}

/** Extracts certificate facts from page texts (page 1 first). */
export function findCertificateFacts(pages: string[]): CertificateFacts {
  const limitations: string[] = ["Extracted from the document's text layer: unverified. Check the original document."];
  const found: { type: CertificateType; span: DocumentSpan }[] = [];
  for (const [type, pattern] of typePatterns) {
    for (const [index, text] of pages.entries()) {
      const match = pattern.exec(text);
      if (match) { found.push({ type, span: { page: index + 1, start: match.index, end: match.index + match[0].length, excerpt: excerpt(text, match.index - 20, match.index + match[0].length + 20) } }); break; }
    }
  }
  // An EICR also mentions "electrical installation"; a guarantee is often mentioned by other certificates.
  const primary = found.find((item) => item.type !== "guarantee") ?? found[0] ?? null;
  const otherTypesMentioned = found.filter((item) => item !== primary && !(primary?.type === "eicr" && item.type === "electrical_installation_certificate")).map((item) => item.type);
  if (otherTypesMentioned.length) limitations.push("The document mentions more than one kind of certificate; confirm what it is.");

  const due = findLabelled(pages, /next inspection(?: due| date| recommended(?: by| no later than)?)?(?: by)?|valid until|valid to|expiry date|expires(?: on)?|date of next (?:inspection|check|service)|renewal date|recommended (?:re-?)?inspection date/, datePattern, parseDocumentDate);
  const inspection = findLabelled(pages, /date of (?:the )?(?:inspection|check|assessment)|inspection date|date inspected/, datePattern, parseDocumentDate);
  const issue = findLabelled(pages, /date of issue|issue date|date issued|date of certificate|certificate date|date of report/, datePattern, parseDocumentDate);
  const completion = findLabelled(pages, /date (?:the )?works (?:were )?completed|works completion date|date of (?:works|extension|conversion) completion/, datePattern, parseDocumentDate);
  if (completion.fact) limitations.push("A stated works-completion date was found. Confirm its association with this property and the relevant works before suggesting an alteration year.");
  if (due.rejected || inspection.rejected || issue.rejected) limitations.push("A date with a two-digit year or an impossible value was found and not used.");
  const reference = findLabelled(pages, /certificate (?:number|no\.?|reference|ref\.?)|report (?:number|reference|no\.?|ref\.?)|serial (?:number|no\.?)|reference (?:number|no\.?)/, String.raw`([A-Z0-9][A-Z0-9\-\/]{3,40})`, (raw) => /\d/.test(raw) ? raw.toUpperCase() : null);

  let instructionLikeText: DocumentSpan | null = null;
  const instruction = /ignore (?:all |any )?(?:previous|prior|above|earlier) instructions|disregard (?:the|all|any) (?:previous|above|prior)|you are (?:an?|the) (?:ai|assistant|language model)|system prompt|(?:assistant|ai)[,:]? (?:please )?(?:mark|set|record|change)/i;
  for (const [index, text] of pages.entries()) {
    const match = instruction.exec(text);
    if (match) { instructionLikeText = { page: index + 1, start: match.index, end: match.index + match[0].length, excerpt: excerpt(text, match.index - 20, match.index + match[0].length + 40) }; break; }
  }
  if (instructionLikeText) limitations.push("The document contains text that reads like instructions to an AI system. It was treated as document content and ignored.");
  if (!pages.join("").trim()) limitations.push("No text layer was found. Scanned documents need OCR, which is not available.");

  return {
    extractor: CERTIFICATE_EXTRACTOR,
    documentType: primary ? { value: primary.type, span: primary.span } : null,
    otherTypesMentioned,
    issueDate: issue.fact,
    worksCompletionDate: completion.fact,
    inspectionDate: inspection.fact,
    dueDate: due.fact,
    reference: reference.fact,
    instructionLikeText,
    limitations,
  };
}

export type CertificateCheck = { code: "expired" | "due_soon"; title: string; detail: string; span: DocumentSpan };

/** Validity checks against a reference date (normally the inspection date). Only document-stated due dates are used. */
export function certificateChecks(facts: CertificateFacts, asOf: string, dueSoonDays = 60): CertificateCheck[] {
  if (!facts.dueDate) return [];
  const label = facts.documentType ? certificateTypeLabels[facts.documentType.value] : "Certificate";
  const due = Date.parse(`${facts.dueDate.value}T00:00:00Z`);
  const reference = Date.parse(`${asOf}T00:00:00Z`);
  if (due < reference) return [{ code: "expired", title: `${label} appears to have expired`, detail: `The document states ${facts.dueDate.value} (page ${facts.dueDate.span.page}), before ${asOf}. Ask for a current certificate.`, span: facts.dueDate.span }];
  if (due - reference <= dueSoonDays * 86_400_000) return [{ code: "due_soon", title: `${label} is due for renewal soon`, detail: `The document states ${facts.dueDate.value} (page ${facts.dueDate.span.page}).`, span: facts.dueDate.span }];
  return [];
}
