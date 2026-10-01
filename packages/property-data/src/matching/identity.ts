import type { UkCountry } from "@surveynt/domain";
import type { LocationConfidence, PropertyLocation } from "../contract";

const postcodePattern = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

/** Returns the postcode in canonical "AA9A 9AA" form, or null when it is not a UK postcode shape. */
export function normalisePostcode(input: string) {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 7) return null;
  const match = postcodePattern.exec(compact);
  return match ? `${match[1]} ${match[2]}` : null;
}

export function looksLikePostcode(query: string) {
  return normalisePostcode(query.trim()) !== null && query.trim().length <= 9;
}

/** Only BT postcodes identify a country (Northern Ireland). Other areas cross national borders. */
export function countryFromPostcode(postcode: string): UkCountry | null {
  return postcode.startsWith("BT") ? "NIR" : null;
}

export const ukBounds = { minLatitude: 49.85, maxLatitude: 60.95, minLongitude: -8.75, maxLongitude: 1.8 } as const;

export function isWithinUkBounds(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= ukBounds.minLatitude && latitude <= ukBounds.maxLatitude
    && longitude >= ukBounds.minLongitude && longitude <= ukBounds.maxLongitude;
}

const uprnPattern = /^[0-9]{1,12}$/;

export function isValidUprn(value: string) {
  return uprnPattern.test(value) && /[1-9]/.test(value);
}

/** Great-circle distance in metres, for display and tests. Database queries use PostGIS geography. */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radius = 6_371_008.8;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

/** How far to look for UPRN candidates around a point of the given quality. */
export function candidateSearchRadiusMetres(confidence: LocationConfidence) {
  if (confidence === "postcode_centroid") return 250;
  if (confidence === "geocoded_address") return 75;
  if (confidence === "surveyor_confirmed") return 30;
  return 0;
}

export type UprnCandidateInput = { uprn: string; latitude: number; longitude: number; distanceMetres: number };

export type UprnCandidateWarning = "origin_is_postcode_centroid" | "origin_is_geocoded" | "multiple_at_same_point" | "no_candidates" | "nearest_is_distant" | "coverage_not_gb" | "reference_not_imported";

export const uprnWarningMessages: Record<UprnCandidateWarning, string> = {
  origin_is_postcode_centroid: "Candidates are near the postcode centre, so they may belong to other properties in the postcode.",
  origin_is_geocoded: "The search point comes from an address search and is approximate.",
  multiple_at_same_point: "Several UPRNs share one location. This usually means flats or units in one building. Confirm using another identifying record.",
  no_candidates: "No UPRN points were found near this location in the imported reference data.",
  nearest_is_distant: "The nearest UPRN point is some distance away. Check that the location is right before relying on it.",
  coverage_not_gb: "OS Open UPRN covers Great Britain only. Northern Ireland properties cannot be matched with it.",
  reference_not_imported: "UPRN reference data has not been imported for this environment.",
};

export type UprnCandidateAssessment = {
  candidates: (UprnCandidateInput & { colocated: number })[];
  warnings: UprnCandidateWarning[];
  /**
   * Always false. OS Open UPRN contains no addresses, so a point match can
   * never establish which property a UPRN identifies. A surveyor must confirm
   * the UPRN with independent evidence.
   */
  autoSelectable: false;
  searchRadiusMetres: number;
};

/** Ranks candidates and explains why none of them can be selected automatically. */
export function assessUprnCandidates(input: { candidates: UprnCandidateInput[]; originConfidence: LocationConfidence; country: UkCountry | null; referenceAvailable: boolean }): UprnCandidateAssessment {
  const searchRadiusMetres = candidateSearchRadiusMetres(input.originConfidence);
  const warnings: UprnCandidateWarning[] = [];
  if (input.country === "NIR") return { candidates: [], warnings: ["coverage_not_gb"], autoSelectable: false, searchRadiusMetres };
  if (!input.referenceAvailable) return { candidates: [], warnings: ["reference_not_imported"], autoSelectable: false, searchRadiusMetres };
  if (input.originConfidence === "postcode_centroid") warnings.push("origin_is_postcode_centroid");
  if (input.originConfidence === "geocoded_address") warnings.push("origin_is_geocoded");
  const sorted = [...input.candidates].sort((a, b) => a.distanceMetres - b.distanceMetres || a.uprn.localeCompare(b.uprn));
  const candidates = sorted.map((candidate) => ({
    ...candidate,
    colocated: sorted.filter((other) => distanceMetres(candidate, other) < 1).length,
  }));
  if (!candidates.length) warnings.push("no_candidates");
  if (candidates.some((candidate) => candidate.colocated > 1)) warnings.push("multiple_at_same_point");
  if (candidates.length && candidates[0].distanceMetres > Math.min(50, searchRadiusMetres)) warnings.push("nearest_is_distant");
  return { candidates, warnings, autoSelectable: false, searchRadiusMetres };
}

export const uprnEvidenceTypes = ["site_inspection", "epc_record", "title_documents", "council_tax_record", "client_documents", "other"] as const;
export type UprnEvidenceType = (typeof uprnEvidenceTypes)[number];

export const uprnEvidenceLabels: Record<UprnEvidenceType, string> = {
  site_inspection: "Confirmed on site",
  epc_record: "Energy certificate record",
  title_documents: "Title or conveyancing documents",
  council_tax_record: "Council tax record",
  client_documents: "Client-provided documents",
  other: "Other (explain)",
};

/** A UPRN may only be recorded with stated evidence; "other" also needs an explanation. */
export function uprnConfirmationProblem(input: { evidenceType: UprnEvidenceType; note?: string | null }) {
  if (input.evidenceType === "other" && !input.note?.trim()) return "Explain how the UPRN was confirmed.";
  return null;
}

/** Stable identity fingerprint for stale-result detection. Address text is deliberately excluded. */
export async function locationFingerprint(location: Pick<PropertyLocation, "country" | "uprn" | "latitude" | "longitude" | "locationConfidence">) {
  const canonical = [
    location.country ?? "",
    location.uprn ?? "",
    location.latitude === null ? "" : location.latitude.toFixed(6),
    location.longitude === null ? "" : location.longitude.toFixed(6),
    location.locationConfidence,
  ].join("|");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Normalised address fingerprint so a later address edit can flag that the stored location may be stale. */
export async function addressFingerprint(address: { line1: string; line2?: string | null; city: string; postcode: string }) {
  const canonical = [address.line1, address.line2 ?? "", address.city, normalisePostcode(address.postcode) ?? address.postcode]
    .map((part) => part.toUpperCase().replace(/\s+/g, " ").trim())
    .join("|");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
