import type { CoverageStatus, InformationClass, LicenceSnapshot, PropertyLocation, ProviderRecord, ProviderResult, ProviderStatus } from "../contract";
import { getSourceDefinition } from "../registry/sources";

/** Point-in-layer lookups against imported reference data (implemented over PostGIS). */
export interface SpatialQuery {
  featuresAt(input: { sourceKey: string; layers: string[]; latitude: number; longitude: number; nearbyMetres: number }): Promise<{
    layer: string;
    available: boolean;
    datasetVersion: string | null;
    sourceUpdatedAt: string | null;
    features: { featureId: string; name: string | null; attributes: Record<string, unknown>; distanceMetres: number; intersects: boolean }[];
  }[]>;
}

export type SaleRecord = {
  transactionId: string;
  price: number;
  transferDate: string;
  propertyType: "D" | "S" | "T" | "F" | "O";
  newBuild: boolean;
  tenure: "F" | "L" | "U";
  ppdCategory: "A" | "B";
  /** Number of UPRNs the published look-up links to this sale; above 1 the price covers several properties. */
  linkedUprnCount: number;
};

/** Exact UPRN look-ups against imported Price Paid data and HM Land Registry's transaction-to-UPRN table. */
export interface HistoryQuery {
  salesForUprn(uprn: string): Promise<
    | { available: false; reason: "price_paid_not_imported" | "lookup_not_imported" | "lookup_not_enabled" }
    | { available: true; pricePaidVersion: string; lookupVersion: string; publishedAt: string | null; postcodeAreas: string[] | null; sales: SaleRecord[]; unresolvedLinks: number }
  >;
}

export type ScottishEpcRecord = { certificateKey: string; lodgementDate: string | null; currentRating: string | null; potentialRating: string | null; propertyType: string | null; builtForm: string | null; constructionAgeBand: string | null; totalFloorAreaM2: number | null };

/** Exact UPRN look-ups against an imported Scottish EPC Register extract. */
export interface ScottishEpcQuery {
  certificatesForUprn(uprn: string): Promise<{ available: false } | { available: true; datasetVersion: string; certificates: ScottishEpcRecord[] }>;
}

/** Global cache for public-source responses. Keys must never contain tenant data. */
export interface PublicCache {
  getOrLoad<T>(key: string, ttlDays: number, load: () => Promise<T>, cacheable: (value: T) => boolean): Promise<T>;
}

export type ProviderContext = {
  now: Date;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  spatial?: SpatialQuery;
  history?: HistoryQuery;
  scottishEpc?: ScottishEpcQuery;
  cache?: PublicCache;
};

export type Applicability = { ok: true } | { ok: false; status: Extract<ProviderStatus, "unsupported" | "not_configured">; message: string; coverage: CoverageStatus };

export interface IntelligenceProvider {
  key: string;
  categories: readonly string[];
  /** Explains up front why a provider cannot answer, so the UI shows "Not checked" rather than an implied negative. */
  applicability(location: PropertyLocation, context: ProviderContext): Applicability;
  run(location: PropertyLocation, context: ProviderContext): Promise<ProviderResult[]>;
}

export function licenceFor(sourceKey: string): LicenceSnapshot {
  return getSourceDefinition(sourceKey)?.licence ?? { name: "Unknown", url: null, attribution: "", restrictions: ["Licence not registered."] };
}

export function informationClassFor(sourceKey: string): InformationClass {
  return getSourceDefinition(sourceKey)?.informationClass ?? "indicative_external";
}

export function expiresAt(sourceKey: string, now: Date) {
  const days = getSourceDefinition(sourceKey)?.refreshPolicy.days ?? 30;
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** Builds a result with registry-derived licence, class and expiry so every snapshot carries provenance. */
export function result(sourceKey: string, input: { category: string; status: ProviderStatus; records?: ProviderRecord[]; coverage: CoverageStatus; now: Date; datasetVersion?: string | null; message?: string | null; errorCode?: string | null; informationClass?: InformationClass }): ProviderResult {
  return {
    source: sourceKey,
    category: input.category,
    status: input.status,
    records: input.records ?? [],
    coverage: input.coverage,
    informationClass: input.informationClass ?? informationClassFor(sourceKey),
    licence: licenceFor(sourceKey),
    retrievedAt: input.now.toISOString(),
    datasetVersion: input.datasetVersion ?? null,
    expiresAt: input.status === "matched" || input.status === "no_match" ? expiresAt(sourceKey, input.now) : null,
    message: input.message ?? null,
    errorCode: input.errorCode ?? null,
  };
}

/** Spatial providers refuse approximate points: a postcode centre is not the building. */
export function requiresPreciseLocation(location: PropertyLocation): Applicability | null {
  if (location.latitude === null || location.longitude === null) return { ok: false, status: "unsupported", message: "The property has no location yet. Resolve it to check this source.", coverage: "unknown" };
  if (location.locationConfidence === "postcode_centroid") return { ok: false, status: "unsupported", message: "The location is only a postcode centre, which is too approximate for this check. Confirm the location first.", coverage: "unknown" };
  return null;
}

export function confidenceForLocation(location: PropertyLocation): ProviderRecord["confidence"] {
  return location.locationConfidence === "surveyor_confirmed" ? "medium" : "low";
}
