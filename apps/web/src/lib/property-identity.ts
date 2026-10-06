import { and, desc, eq, gt, sql } from "drizzle-orm";
import { addressLookups, auditEvents, createDatabase, properties, propertyIdentityEvents, withTenant, type Database, type TenantTransaction } from "@surveynt/db";
import type { UkCountry } from "@surveynt/domain";
import {
  addressFingerprint,
  assessUprnCandidates,
  candidateSearchRadiusMetres,
  isValidUprn,
  isWithinUkBounds,
  looksLikePostcode,
  lookupPostcode,
  nominatimLicence,
  normalisePostcode,
  postcodesIoLicence,
  ProviderError,
  searchAddress,
  uprnConfirmationProblem,
  uprnWarningMessages,
  normaliseLocationConfidence,
  type LocationConfidence,
  type RateGate,
  type UprnEvidenceType,
} from "@surveynt/property-data";
import { findUprnCandidates, getSourceState, uprnExists } from "@surveynt/property-data/db";
import { databasePublicCache } from "./provider-cache";
import { isDemoOrganisation } from "./stakeholder-demo";

export const intelligenceEnabled = () => process.env.PROPERTY_INTELLIGENCE_ENABLED === "true";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rows<T>(result: unknown) {
  return (result as { rows: T[] }).rows;
}

/** Database-backed request spacing shared by every server instance. */
export function databaseRateGate(db: Database): RateGate {
  return {
    async acquire(key, minIntervalMs, maxWaitMs) {
      const interval = minIntervalMs / 1000;
      const result = await db.execute(sql`
        insert into provider_rate_limits (key, next_available_at) values (${key}, now() + make_interval(secs => ${interval}))
        on conflict (key) do update set next_available_at = greatest(provider_rate_limits.next_available_at, now()) + make_interval(secs => ${interval})
        where provider_rate_limits.next_available_at <= now() + make_interval(secs => ${maxWaitMs / 1000})
        returning greatest(0, extract(epoch from (next_available_at - now())) * 1000 - ${minIntervalMs}) as wait_ms`);
      const reserved = rows<{ wait_ms: number | string }>(result)[0];
      if (!reserved) return false;
      const wait = Number(reserved.wait_ms);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, maxWaitMs)));
      return true;
    },
  };
}

export type AddressCandidate = {
  index: number;
  source: "postcodes_io" | "nominatim" | "demo";
  label: string;
  line1: string | null;
  city: string | null;
  postcode: string | null;
  country: UkCountry | null;
  latitude: number;
  longitude: number;
  precision: "postcode" | "building" | "street" | "area";
  confidence: LocationConfidence;
};

export type AddressSearchResponse = {
  lookupId: string | null;
  status: "matched" | "no_match" | "unavailable" | "not_configured" | "invalid";
  message: string | null;
  candidates: AddressCandidate[];
  attribution: string[];
  demo: boolean;
};

// Labelled development demo results. They never reach a connected workspace.
const demoCandidates: AddressCandidate[] = [
  { index: 0, source: "demo", label: "DEMO · 18 Royal York Crescent, Bristol BS8 4JX", line1: "18 Royal York Crescent", city: "Bristol", postcode: "BS8 4JX", country: "ENG", latitude: 51.4544, longitude: -2.6198, precision: "building", confidence: "geocoded_address" },
  { index: 1, source: "demo", label: "DEMO · BS8 4JX postcode centre", line1: null, city: "Bristol", postcode: "BS8 4JX", country: "ENG", latitude: 51.4545, longitude: -2.6201, precision: "postcode", confidence: "postcode_centroid" },
];

type TenantContext = { organisationId: string; internalUserId: string | null; demo: boolean };

/** Submitted (never per-keystroke) address search. Manual entry is always the fallback. */
export async function searchAddresses(context: TenantContext, rawQuery: string): Promise<AddressSearchResponse> {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 3 || query.length > 200) return { lookupId: null, status: "invalid", message: "Enter between 3 and 200 characters.", candidates: [], attribution: [], demo: context.demo };
  if (context.demo || await isDemoOrganisation(context.organisationId)) {
    return { lookupId: "demo", status: "matched", message: "Demo results only. These are not live address records.", candidates: demoCandidates, attribution: ["Demo data"], demo: true };
  }
  if (!intelligenceEnabled()) return { lookupId: null, status: "not_configured", message: "Address search is not enabled for this deployment. Enter the address manually.", candidates: [], attribution: [], demo: false };
  const db = createDatabase();
  const usePostcode = looksLikePostcode(query);
  const provider = usePostcode ? "postcodes_io" : "nominatim";
  const source = await getSourceState(db, provider);
  if (!source.enabled) return { lookupId: null, status: "not_configured", message: "Address search has not been enabled after source verification. Enter the address manually.", candidates: [], attribution: [], demo: false };
  const tenantGate = await databaseRateGate(db).acquire(`address_search:${context.organisationId}`, 400, 0);
  if (!tenantGate) return { lookupId: null, status: "unavailable", message: "Searches are being sent too quickly. Wait a moment and try again.", candidates: [], attribution: [], demo: false };
  const queryHash = await sha256(`${provider}|${query.toLowerCase()}`);
  const cached = await withTenant(db, context.organisationId, (tx) => tx.select().from(addressLookups).where(and(eq(addressLookups.organisationId, context.organisationId), eq(addressLookups.provider, provider), eq(addressLookups.queryHash, queryHash), gt(addressLookups.expiresAt, new Date()))).orderBy(desc(addressLookups.createdAt)).limit(1));
  if (cached[0]) {
    const candidates = cached[0].results as unknown as AddressCandidate[];
    return { lookupId: cached[0].id, status: candidates.length ? "matched" : "no_match", message: candidates.length ? null : "No matching addresses were found. Enter the address manually.", candidates, attribution: [provider === "postcodes_io" ? postcodesIoLicence.attribution : nominatimLicence.attribution], demo: false };
  }
  let status: AddressSearchResponse["status"];
  let message: string | null = null;
  let candidates: AddressCandidate[] = [];
  try {
    if (usePostcode) {
      const postcode = normalisePostcode(query)!;
      const result = await databasePublicCache(db).getOrLoad(`postcodes_io|v1|${postcode}`, 30, () => lookupPostcode(postcode, { baseUrl: process.env.POSTCODES_IO_BASE_URL }), (value) => value.status === "matched");
      if (result.status === "matched") {
        status = "matched";
        candidates = [{ index: 0, source: "postcodes_io", label: `${result.result.postcode} (postcode centre${result.result.adminDistrict ? `, ${result.result.adminDistrict}` : ""})`, line1: null, city: result.result.adminDistrict, postcode: result.result.postcode, country: result.result.country, latitude: result.result.latitude, longitude: result.result.longitude, precision: "postcode", confidence: "postcode_centroid" }];
      } else {
        status = result.status === "invalid" ? "invalid" : result.status === "unsupported" ? "not_configured" : "no_match";
        message = result.message;
      }
    } else {
      const result = await searchAddress(query, { baseUrl: process.env.NOMINATIM_BASE_URL, userAgent: process.env.NOMINATIM_USER_AGENT, minIntervalMs: Number(process.env.NOMINATIM_MIN_INTERVAL_MS ?? 1100), rateGate: databaseRateGate(db) });
      if (result.status === "matched") {
        status = "matched";
        candidates = result.results.map((item, index) => ({ index, source: "nominatim", label: item.label, line1: item.line1, city: item.city, postcode: item.postcode, country: item.country, latitude: item.latitude, longitude: item.longitude, precision: item.precision, confidence: "geocoded_address" }));
      } else {
        status = result.status;
        message = result.message;
      }
    }
  } catch (reason) {
    status = "unavailable";
    message = reason instanceof ProviderError && reason.code === "rate_limited" ? "Address search is busy. Try again shortly or enter the address manually." : "Address search is temporarily unavailable. Enter the address manually.";
  }
  if (status !== "matched" && status !== "no_match") return { lookupId: null, status, message, candidates: [], attribution: [], demo: false };
  const [lookup] = await withTenant(db, context.organisationId, (tx) => tx.insert(addressLookups).values({ organisationId: context.organisationId, userId: context.internalUserId, provider, queryHash, status, results: candidates as unknown as Record<string, unknown>[], expiresAt: new Date(Date.now() + 86_400_000) }).returning({ id: addressLookups.id }));
  return { lookupId: lookup.id, status, message, candidates, attribution: [provider === "postcodes_io" ? postcodesIoLicence.attribution : nominatimLicence.attribution], demo: false };
}

async function loadCandidate(tx: TenantTransaction, organisationId: string, lookupId: string, index: number) {
  const [lookup] = await tx.select().from(addressLookups).where(and(eq(addressLookups.id, lookupId), eq(addressLookups.organisationId, organisationId), gt(addressLookups.expiresAt, new Date()))).limit(1);
  const candidate = lookup ? (lookup.results as unknown as AddressCandidate[])[index] : undefined;
  return candidate ?? null;
}

export type UprnResolution = {
  candidates: { uprn: string; latitude: number; longitude: number; distanceMetres: number; colocated: number }[];
  warnings: { code: string; message: string }[];
  autoSelectable: false;
  searchRadiusMetres: number;
  datasetVersion: string | null;
};

async function resolveUprns(db: Database | TenantTransaction, input: { latitude: number; longitude: number; confidence: LocationConfidence; country: UkCountry | null }): Promise<UprnResolution> {
  const radius = candidateSearchRadiusMetres(input.confidence);
  const source = await getSourceState(db, "os_open_uprn");
  const reference = input.country === "NIR" || !source.enabled ? { referenceAvailable: source.enabled, datasetVersion: null, candidates: [] } : await findUprnCandidates(db, { latitude: input.latitude, longitude: input.longitude, radiusMetres: radius });
  const assessment = assessUprnCandidates({ candidates: reference.candidates, originConfidence: input.confidence, country: input.country, referenceAvailable: reference.referenceAvailable });
  return { ...assessment, warnings: assessment.warnings.map((code) => ({ code, message: uprnWarningMessages[code] })), datasetVersion: reference.datasetVersion };
}

export type ResolveResponse = { candidate: AddressCandidate; uprn: UprnResolution; demo: boolean } | { problem: "not_found" | "too_imprecise"; message: string };

export async function resolveCandidate(context: TenantContext, lookupId: string, index: number): Promise<ResolveResponse> {
  if (context.demo || await isDemoOrganisation(context.organisationId)) {
    const candidate = demoCandidates[index];
    if (!candidate || lookupId !== "demo") return { problem: "not_found", message: "That search result has expired. Search again." };
    const point = { latitude: 51.4544, longitude: -2.6198 };
    const assessment = assessUprnCandidates({ candidates: ["990000000001", "990000000002", "990000000003"].map((uprn) => ({ uprn, ...point, distanceMetres: 2 })), originConfidence: candidate.confidence, country: "ENG", referenceAvailable: true });
    return { candidate, demo: true, uprn: { ...assessment, warnings: assessment.warnings.map((code) => ({ code, message: uprnWarningMessages[code] })), datasetVersion: "DEMO — synthetic" } };
  }
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const candidate = await loadCandidate(tx, context.organisationId, lookupId, index);
    if (!candidate) return { problem: "not_found" as const, message: "That search result has expired. Search again." };
    if (candidate.precision === "area") return { problem: "too_imprecise" as const, message: "That result only identifies an area. Search by full address or postcode instead." };
    return { candidate, demo: false, uprn: await resolveUprns(tx, { latitude: candidate.latitude, longitude: candidate.longitude, confidence: candidate.confidence, country: candidate.country }) };
  });
}

export type IdentityAction =
  | { action: "set_location"; version: number; lookupId: string; index: number; replaceConfirmed?: boolean }
  | { action: "confirm_uprn"; version: number; uprn: string; evidenceType: UprnEvidenceType; note?: string | null; fromCandidates?: boolean; useUprnPoint?: boolean }
  | { action: "clear_uprn"; version: number; reason: string }
  | { action: "clear_location"; version: number; reason: string }
  | { action: "set_country"; version: number; country: UkCountry | null };

type IdentityState = Pick<typeof properties.$inferSelect, "country" | "uprn" | "latitude" | "longitude" | "locationConfidence" | "locationResolutionMethod" | "uprnEvidenceType">;
const snapshot = (property: IdentityState) => ({ country: property.country, uprn: property.uprn, latitude: property.latitude, longitude: property.longitude, locationConfidence: property.locationConfidence, locationResolutionMethod: property.locationResolutionMethod, uprnEvidenceType: property.uprnEvidenceType });

export type IdentityOutcome =
  | { kind: "updated"; property: typeof properties.$inferSelect; warnings: string[] }
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string };

/** Applies one audited identity change with optimistic concurrency. External data never overwrites a surveyor confirmation silently. */
export async function updatePropertyIdentity(context: TenantContext & { organisationId: string }, propertyId: string, input: IdentityAction): Promise<IdentityOutcome> {
  const db = createDatabase();
  const persistedDemo = await isDemoOrganisation(context.organisationId, db);
  return withTenant(db, context.organisationId, async (tx) => {
    const [current] = await tx.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!current) return { kind: "missing" };
    if (current.version !== input.version) return { kind: "conflict" };
    const now = new Date();
    const warnings: string[] = [];
    let changes: Partial<typeof properties.$inferInsert> = {};
    let evidence: Record<string, unknown> = {};
    switch (input.action) {
      case "set_location": {
        if (normaliseLocationConfidence(current.locationConfidence) === "surveyor_confirmed" && !input.replaceConfirmed) return { kind: "invalid", message: "This location was confirmed by a surveyor. Choose to replace it explicitly." };
        const candidate = persistedDemo && input.lookupId === "demo" ? demoCandidates[input.index] : await loadCandidate(tx, context.organisationId, input.lookupId, input.index);
        if (!candidate) return { kind: "invalid", message: "That search result has expired. Search again." };
        if (candidate.precision === "area" || !isWithinUkBounds(candidate.latitude, candidate.longitude)) return { kind: "invalid", message: "That result is too imprecise to locate the property." };
        changes = {
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          locationConfidence: candidate.confidence,
          locationResolutionMethod: candidate.source === "postcodes_io" ? "postcode_lookup" : "address_search",
          resolvedAt: now,
          confirmedByUserId: null,
          identityAddressFingerprint: await addressFingerprint(current),
          ...(current.country === null && candidate.country ? { country: candidate.country } : {}),
        };
        evidence = { lookupId: input.lookupId, source: candidate.source, label: candidate.label, precision: candidate.precision };
        if (candidate.country && current.country && candidate.country !== current.country) warnings.push("The search result is in a different country from the one recorded for this property. The recorded country was kept.");
        break;
      }
      case "confirm_uprn": {
        if (!isValidUprn(input.uprn)) return { kind: "invalid", message: "A UPRN is up to 12 digits." };
        const problem = uprnConfirmationProblem({ evidenceType: input.evidenceType, note: input.note });
        if (problem) return { kind: "invalid", message: problem };
        const reference = await uprnExists(tx, input.uprn);
        const referenceCheck = !reference.referenceAvailable ? "reference_unavailable" : reference.exists ? "found_in_active_release" : "not_found_in_active_release";
        if (referenceCheck === "not_found_in_active_release") warnings.push("This UPRN is not in the imported OS Open UPRN release. It may be newer than the release, so check it carefully.");
        const duplicates = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.organisationId, context.organisationId), eq(properties.uprn, input.uprn)));
        if (duplicates.some((item) => item.id !== propertyId)) warnings.push("Another property record in this workspace already uses this UPRN. Check for a duplicate record.");
        const usePoint = (input.useUprnPoint ?? true) && reference.point !== null;
        changes = {
          uprn: input.uprn,
          uprnConfirmedAt: now,
          uprnEvidenceType: input.evidenceType,
          confirmedByUserId: context.internalUserId,
          ...(usePoint && reference.point ? { latitude: reference.point.latitude, longitude: reference.point.longitude, locationConfidence: "surveyor_confirmed" as const, locationResolutionMethod: input.fromCandidates ? "uprn_candidate_confirmed" : "uprn_entered", resolvedAt: now, identityAddressFingerprint: await addressFingerprint(current) } : {}),
        };
        evidence = { evidenceType: input.evidenceType, note: input.note?.trim() || null, referenceCheck, fromCandidates: Boolean(input.fromCandidates), usedUprnPoint: usePoint };
        break;
      }
      case "clear_uprn":
        changes = { uprn: null, uprnConfirmedAt: null, uprnEvidenceType: null };
        evidence = { reason: input.reason };
        break;
      case "clear_location":
        changes = { latitude: null, longitude: null, locationConfidence: "unresolved", locationResolutionMethod: null, resolvedAt: null, identityAddressFingerprint: null };
        evidence = { reason: input.reason };
        break;
      case "set_country":
        changes = { country: input.country };
        break;
    }
    const [updated] = await tx.update(properties).set({ ...changes, version: current.version + 1, updatedAt: now }).where(and(eq(properties.id, propertyId), eq(properties.organisationId, context.organisationId), eq(properties.version, current.version))).returning();
    if (!updated) return { kind: "conflict" };
    await tx.insert(propertyIdentityEvents).values({ organisationId: context.organisationId, propertyId, actorUserId: context.internalUserId, action: input.action, previous: snapshot(current), next: snapshot(updated), evidence: { ...evidence, warnings } });
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: `property.identity.${input.action}`, resourceType: "property", resourceId: propertyId, metadata: { fromVersion: current.version, toVersion: updated.version } });
    return { kind: "updated", property: updated, warnings };
  });
}

export function identityView(property: Pick<typeof properties.$inferSelect, "country" | "uprn" | "latitude" | "longitude" | "locationConfidence" | "locationResolutionMethod" | "resolvedAt" | "uprnConfirmedAt" | "uprnEvidenceType" | "identityAddressFingerprint">, currentAddressFingerprint: string | null) {
  return {
    country: property.country,
    uprn: property.uprn,
    latitude: property.latitude,
    longitude: property.longitude,
    locationConfidence: normaliseLocationConfidence(property.locationConfidence),
    locationResolutionMethod: property.locationResolutionMethod,
    resolvedAt: property.resolvedAt?.toISOString() ?? null,
    uprnConfirmedAt: property.uprnConfirmedAt?.toISOString() ?? null,
    uprnEvidenceType: property.uprnEvidenceType,
    addressChangedSinceResolution: Boolean(property.identityAddressFingerprint && currentAddressFingerprint && property.identityAddressFingerprint !== currentAddressFingerprint),
  };
}
