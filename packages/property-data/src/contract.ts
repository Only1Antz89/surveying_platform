import type { UkCountry } from "@surveynt/domain";

/** How the stored property point was obtained. The value sets the ceiling on what may be inferred from it. */
export const locationConfidences = ["unresolved", "postcode_centroid", "geocoded_address", "surveyor_confirmed"] as const;
export type LocationConfidence = (typeof locationConfidences)[number];

export const locationConfidenceLabels: Record<LocationConfidence, string> = {
  unresolved: "Location not resolved",
  postcode_centroid: "Approximate: postcode centre",
  geocoded_address: "Approximate: matched address search",
  surveyor_confirmed: "Confirmed by a surveyor",
};

/**
 * The England release (migration 0006) stores "approximate", "confirmed" and
 * "exact" in the same column. Map them conservatively: anything not confirmed
 * by its identity-confirmation step stays approximate.
 */
export function normaliseLocationConfidence(value: string | null | undefined): LocationConfidence {
  switch (value) {
    case "postcode_centroid": case "geocoded_address": case "surveyor_confirmed": case "unresolved": return value;
    case "approximate": return "geocoded_address";
    case "confirmed": case "exact": return "surveyor_confirmed";
    default: return "unresolved";
  }
}

export const locationResolutionMethods = ["postcode_lookup", "address_search", "uprn_candidate_confirmed", "uprn_entered", "map_placement"] as const;
export type LocationResolutionMethod = (typeof locationResolutionMethods)[number];

export const addressSources = ["manual", "postcodes_io", "nominatim"] as const;
export type AddressSource = (typeof addressSources)[number];

/** Provider input. Address lines are tenant data and must never be sent to global caches or logs. */
export type PropertyLocation = {
  propertyId: string;
  country: UkCountry | null;
  uprn: string | null;
  latitude: number | null;
  longitude: number | null;
  locationConfidence: LocationConfidence;
  postcode: string | null;
};

export const providerStatuses = ["matched", "no_match", "unsupported", "not_configured", "unavailable", "error"] as const;
export type ProviderStatus = (typeof providerStatuses)[number];

export const providerStatusLabels: Record<ProviderStatus, string> = {
  matched: "Record found",
  no_match: "No record found",
  unsupported: "Not covered for this property",
  not_configured: "Not configured",
  unavailable: "Temporarily unavailable",
  error: "Error",
};

export const informationClasses = ["surveyor_verified", "authoritative_external", "indicative_external"] as const;
export type InformationClass = (typeof informationClasses)[number];

export const informationClassLabels: Record<InformationClass, string> = {
  surveyor_verified: "Surveyor verified",
  authoritative_external: "Authoritative external record",
  indicative_external: "Indicative external context",
};

export const coverageStatuses = ["covered", "partial", "not_covered", "unknown"] as const;
export type CoverageStatus = (typeof coverageStatuses)[number];

export const matchMethods = ["uprn_exact", "point_in_polygon", "point_within_distance", "postcode", "address_candidate", "none"] as const;
export type MatchMethod = (typeof matchMethods)[number];

export type LicenceSnapshot = {
  name: string;
  url: string | null;
  attribution: string;
  restrictions: string[];
};

export type ProviderEvidence = { label: string; url: string };

/** One normalised record from a provider. `data` is validated per category before storage. */
export type ProviderRecord = {
  sourceRecordId: string | null;
  category: string;
  data: Record<string, unknown>;
  evidence: ProviderEvidence[];
  matchMethod: MatchMethod;
  confidence: "high" | "medium" | "low";
  sourceUpdatedAt: string | null;
};

export type ProviderResult = {
  source: string;
  category: string;
  status: ProviderStatus;
  records: ProviderRecord[];
  coverage: CoverageStatus;
  informationClass: InformationClass;
  licence: LicenceSnapshot;
  retrievedAt: string;
  datasetVersion: string | null;
  expiresAt: string | null;
  /** Safe, user-presentable explanation. Never contains secrets or payloads. */
  message: string | null;
  errorCode: string | null;
};
