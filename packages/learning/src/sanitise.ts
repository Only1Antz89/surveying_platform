import type { CandidateContent } from "./extract";

// Pipeline step 3. Deterministic redaction and generalisation. This reduces
// what a reviewer must look for; it does not make anything anonymous. Every
// free-text field is still rewritten by a reviewer before release.

export const SANITISER = "sanitiser-v1";

export type KnownIdentifiers = {
  /** Client, contact, surveyor and firm names held in the tenant workspace. */
  names: string[];
  /** Address lines, town and postcode of the property. */
  addressParts: string[];
  /** Job, certificate and other references. */
  references: string[];
};

export type Finding = { field: string; kind: string; count: number };
export type SanitisedText = { text: string; findings: Omit<Finding, "field">[]; residual: string[] };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const months = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const streetWords = "Road|Rd|Street|St|Avenue|Ave|Lane|Close|Drive|Way|Crescent|Gardens|Place|Terrace|Court|Grove|Hill|Mews|Square|Walk|Row|Park|Rise|Green|Vale|View|Parade";

const titledName = /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame|Lady|Lord)\.?\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?/g;

// Order matters: specific identifiers first, then generalisation.
const patterns: { kind: string; pattern: RegExp; replace: string | ((match: string, ...groups: string[]) => string) }[] = [
  { kind: "email", pattern: /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g, replace: "[email removed]" },
  { kind: "url", pattern: /\bhttps?:\/\/\S+|\bwww\.[^\s,;]+/gi, replace: "[link removed]" },
  { kind: "file_name", pattern: /\b[\w-]+\.(?:jpe?g|png|heic|heif|gif|tiff?|webp|pdf|docx?|xlsx?|csv|txt|zip)\b/gi, replace: "[file name removed]" },
  { kind: "coordinates", pattern: /-?\d{1,2}\.\d{3,}\s*[,/ ]\s*-?\d{1,3}\.\d{3,}/g, replace: "[location removed]" },
  { kind: "grid_reference", pattern: /\b[HJNOST][A-HJ-Z]\s?\d{3,5}\s?\d{3,5}\b/g, replace: "[location removed]" },
  { kind: "postcode", pattern: /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/gi, replace: "[postcode removed]" },
  { kind: "phone", pattern: /(?:\+44\s?\(?0?\)?\s?|\b0)\d(?:[\s-]?\d){8,9}\b/g, replace: "[phone removed]" },
  { kind: "reference", pattern: /\b\d{4}(?:-\d{4}){2,4}\b|\b[A-Z]{2,6}[-/]\d{2,}(?:[-/]\d+)*\b/g, replace: "[reference removed]" },
  { kind: "long_number", pattern: /\b\d{7,}\b/g, replace: "[number removed]" },
  { kind: "street_address", pattern: new RegExp(`\\b\\d{1,4}[A-Za-z]?,?\\s+(?:[A-Z][\\w'-]+\\s+){1,3}(?:${streetWords})\\b`, "g"), replace: "[address removed]" },
  { kind: "date", pattern: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${months})\\.?,?\\s+(\\d{4})\\b`, "gi"), replace: (_match, year) => year },
  { kind: "date", pattern: new RegExp(`\\b(?:${months})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), replace: (_match, year) => year },
  { kind: "date", pattern: /\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b/g, replace: (_match, year) => year },
  { kind: "date", pattern: /\b(\d{4})-\d{2}-\d{2}\b/g, replace: (_match, year) => year },
  { kind: "date", pattern: new RegExp(`\\b(?:${months})\\.?\\s+(\\d{4})\\b`, "gi"), replace: (_match, year) => year },
];

// Capitalised words that are ordinary in survey text. Anything else capitalised
// mid-sentence is listed for the privacy reviewer as a possible identifier.
const vocabulary = new Set(("I The A An It This That These There Their They We Our Some No Not Further Repairs Recommend Further " +
  "Roof Chimney Wall Walls Window Windows Door Doors Floor Floors Ceiling Ceilings Kitchen Bathroom Bedroom Bedrooms Loft Garage Garden Hall Landing Lounge Utility Cellar Basement " +
  "Rating Condition NI NA EPC RICS UK England Wales Scotland Northern Ireland Victorian Edwardian Georgian Interwar Post War Pre Building Regulations Control Planning " +
  "Gas Electrical Electric Water Heating Drainage Boiler PVC UPVC DPC DPM MDF OSB GRP EWI IWI LED RCD CU TRV CO").split(" "));

function knownPatterns(known: KnownIdentifiers) {
  const out: { kind: string; pattern: RegExp }[] = [];
  const add = (kind: string, values: string[]) => {
    for (const value of values) {
      const trimmed = value.trim();
      if (trimmed.length < 3) continue;
      out.push({ kind, pattern: new RegExp(`\\b${escape(trimmed)}\\b`, "gi") });
      if (kind === "known_name") for (const part of trimmed.split(/\s+/)) if (part.length >= 3 && /^[A-Z]/.test(part) && !vocabulary.has(part)) out.push({ kind, pattern: new RegExp(`\\b${escape(part)}\\b`, "g") });
    }
  };
  add("known_name", known.names);
  add("known_address", known.addressParts);
  add("known_reference", known.references);
  return out.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
}

/** Redacts identifiers in one text and lists capitalised terms that remain for human review. */
export function scanText(text: string, known: KnownIdentifiers): SanitisedText {
  const counts = new Map<string, number>();
  let output = text;
  // Titled names first, so "Mrs" goes with the surname it introduces.
  output = output.replace(titledName, () => { counts.set("titled_name", (counts.get("titled_name") ?? 0) + 1); return "[name removed]"; });
  for (const { kind, pattern } of knownPatterns(known)) {
    output = output.replace(pattern, () => { counts.set(kind, (counts.get(kind) ?? 0) + 1); return "[identifier removed]"; });
  }
  for (const { kind, pattern, replace } of patterns) {
    output = output.replace(pattern, (...args) => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      return typeof replace === "string" ? replace : replace(...(args as [string, ...string[]]));
    });
  }
  const residual = new Set<string>();
  for (const sentence of output.split(/(?<=[.!?:;])\s+|\n+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((word, index) => {
      const clean = word.replace(/^[^\w]+|[^\w]+$/g, "");
      if (index > 0 && /^[A-Z][a-z'-]{2,}$/.test(clean) && !vocabulary.has(clean)) residual.add(clean);
    });
  }
  return { text: output, findings: [...counts].map(([kind, count]) => ({ kind, count })), residual: [...residual].slice(0, 20) };
}

/** True when the text still contains something the patterns recognise as an identifier. */
export function containsIdentifiers(text: string, known: KnownIdentifiers = { names: [], addressParts: [], references: [] }) {
  const scanned = scanText(text, known);
  return scanned.findings.some((finding) => finding.kind !== "date");
}

// Generalisation of structured context.
export const ageBands = ["before_1919", "1919_1944", "1945_1964", "1965_1982", "1983_2002", "2003_onwards"] as const;
export type AgeBand = (typeof ageBands)[number];

const periodToBand: Record<string, AgeBand> = {
  before_1900: "before_1919", "1900_1929": "before_1919", "1930_1949": "1919_1944", "1950_1966": "1945_1964", "1967_1975": "1965_1982", "1976_1982": "1965_1982",
  "1983_1990": "1983_2002", "1991_1995": "1983_2002", "1996_2002": "1983_2002", "2003_2006": "2003_onwards", "2007_2011": "2003_onwards", "2012_onwards": "2003_onwards",
};

export function ageBandFor(period: string | null, yearBuilt: number | null): AgeBand | null {
  if (yearBuilt) return yearBuilt < 1919 ? "before_1919" : yearBuilt < 1945 ? "1919_1944" : yearBuilt < 1965 ? "1945_1964" : yearBuilt < 1983 ? "1965_1982" : yearBuilt < 2003 ? "1983_2002" : "2003_onwards";
  return period ? periodToBand[period] ?? null : null;
}

export type SanitisedCase = {
  jurisdiction: string;
  serviceLevel: string;
  template: string;
  property: { propertyType: string | null; builtForm: string | null; ageBand: AgeBand | null; storeys: "1" | "2" | "3" | "4 or more" | null };
  elementKey: string;
  elementLabel: string;
  inspectionStatus: string | null;
  limitation: string | null;
  conditionRating: string | null;
  nextActions: string[];
  text: { construction: string | null; surveyorObservations: string[]; clientStatements: string[]; recordContext: string[]; commentary: string | null; limitations: string | null };
  photoCount: number;
};

export type SanitisationResult = { transformer: typeof SANITISER; case: SanitisedCase; findings: Finding[]; residualTerms: string[]; flags: string[]; quasiKey: string };

/** The fields a linkage attack would combine; used for the rare-combination check. */
export function quasiIdentifierKey(item: Pick<SanitisedCase, "jurisdiction" | "property" | "elementKey" | "conditionRating">) {
  return [item.jurisdiction, item.property.propertyType, item.property.builtForm, item.property.ageBand, item.property.storeys, item.elementKey, item.conditionRating].map((part) => part ?? "-").join("|");
}

/** Sanitises one candidate. Flags never clear themselves; reviewers decide. */
export function sanitiseCandidate(content: CandidateContent, known: KnownIdentifiers): SanitisationResult {
  const findings: Finding[] = [];
  const residual = new Set<string>();
  const clean = (field: string, value: string | null) => {
    if (!value) return null;
    const scanned = scanText(value, known);
    for (const finding of scanned.findings) findings.push({ field, ...finding });
    for (const term of scanned.residual) residual.add(term);
    return scanned.text;
  };
  const byKind = (kind: string) => content.observations.filter((item) => item.kind === kind).map((item, index) => clean(`observations.${kind}.${index}`, item.text)!);
  const storeys = content.property.storeys;
  const sanitised: SanitisedCase = {
    jurisdiction: content.jurisdiction,
    serviceLevel: content.serviceLevel,
    template: content.template,
    property: { propertyType: content.property.propertyType, builtForm: content.property.builtForm, ageBand: ageBandFor(content.property.constructionPeriod, content.property.yearBuilt), storeys: storeys === null ? null : storeys >= 4 ? "4 or more" : (String(storeys) as "1" | "2" | "3") },
    elementKey: content.element.key,
    elementLabel: content.element.label,
    inspectionStatus: content.element.inspectionStatus,
    limitation: content.element.limitation,
    conditionRating: content.element.conditionRating,
    nextActions: [...new Set(content.observations.map((item) => item.nextAction).filter((value): value is string => Boolean(value)))],
    text: {
      construction: clean("construction", content.element.construction),
      surveyorObservations: [...byKind("current_observation"), ...byKind("measurement")],
      clientStatements: byKind("client_claim"),
      recordContext: [...byKind("external_record"), ...byKind("historical_reference")],
      commentary: clean("commentary", content.element.commentary),
      limitations: clean("limitations", content.element.limitationsText),
    },
    photoCount: content.photoCount,
  };
  // Room and location labels are free text written about a specific home; they are never carried over.
  if (content.element.location) findings.push({ field: "location", kind: "dropped", count: 1 });
  if (content.property.yearBuilt) findings.push({ field: "property.yearBuilt", kind: "generalised_to_age_band", count: 1 });
  if (storeys !== null && storeys >= 4) findings.push({ field: "property.storeys", kind: "generalised", count: 1 });
  const flags = ["free_text_requires_rewrite"];
  if (residual.size) flags.push("possible_identifier");
  if (content.photoCount > 0) flags.push("photo_manual_review_required");
  if (sanitised.text.clientStatements.length) flags.push("client_statement_unverified");
  return { transformer: SANITISER, case: sanitised, findings, residualTerms: [...residual], flags, quasiKey: quasiIdentifierKey(sanitised) };
}

/**
 * Rare-combination check against what is already staged. Below the reviewers'
 * threshold the case is generalised further (built form and storeys dropped);
 * if it is still rare it is quarantined for manual review. Passing this check
 * does not prove anonymity; no fixed threshold does.
 */
export function applyRarityCheck(result: SanitisationResult, countFor: (quasiKey: string) => number, reviewBelow: number): SanitisationResult & { quarantined: boolean } {
  if (countFor(result.quasiKey) >= reviewBelow) return { ...result, quarantined: false };
  const generalised: SanitisedCase = { ...result.case, property: { ...result.case.property, builtForm: null, storeys: null } };
  const quasiKey = quasiIdentifierKey(generalised);
  const findings = [...result.findings, { field: "property", kind: "generalised_for_rarity", count: 1 }];
  if (countFor(quasiKey) >= reviewBelow) return { ...result, case: generalised, quasiKey, findings, flags: [...result.flags, "generalised_for_rarity"], quarantined: false };
  return { ...result, case: generalised, quasiKey, findings, flags: [...result.flags, "rare_combination"], quarantined: true };
}
