import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvents,
  backgroundJobs,
  createDatabase,
  dataSources,
  datasetVersions,
  enrichmentRuns,
  properties,
  propertyIntelligenceSnapshots,
} from "@surveynt/db";
import {
  epcProvider,
  addressCandidateSchema,
  locationFingerprint,
  planningDataProvider,
  propertyLocationSchema,
  searchNominatim,
  searchPostcode,
  sourceRegistry,
  validateProviderResult,
  type AddressCandidate,
  type PropertyLocation,
  type ProviderResult,
} from "@surveynt/property-data";

const intelligenceJobType = "property_intelligence_refresh";
const maximumAttempts = 5;

async function redisCommand(command: Array<string | number>) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return null;
    return (await response.json() as { result?: unknown }).result ?? null;
  } catch {
    return null;
  }
}

async function readAddressCache(cacheKey: string, organisationId: string) {
  const cached = await redisCommand(["GET", cacheKey]);
  if (typeof cached === "string") return cached;
  if (!process.env.DATABASE_ADMIN_URL) return null;
  try {
    const db = createDatabase(process.env.DATABASE_ADMIN_URL);
    const result = await db.execute(sql`
      select candidates
      from address_search_cache
      where cache_key = ${cacheKey}
        and organisation_id = ${organisationId}
        and expires_at > now()
      limit 1
    `);
    return result.rows[0]?.candidates ? JSON.stringify(result.rows[0].candidates) : null;
  } catch {
    return null;
  }
}

async function writeAddressCache(cacheKey: string, organisationId: string, candidates: AddressCandidate[], ttl: number) {
  const stored = await redisCommand(["SET", cacheKey, JSON.stringify(candidates), "EX", ttl]);
  if (stored === "OK" || !process.env.DATABASE_ADMIN_URL) return;
  try {
    const db = createDatabase(process.env.DATABASE_ADMIN_URL);
    await db.execute(sql`
      insert into address_search_cache (cache_key, organisation_id, candidates, expires_at)
      values (${cacheKey}, ${organisationId}, ${JSON.stringify(candidates)}::jsonb, now() + (${ttl} * interval '1 second'))
      on conflict (cache_key) do update
      set organisation_id = excluded.organisation_id,
          candidates = excluded.candidates,
          expires_at = excluded.expires_at,
          updated_at = now()
    `);
    await db.execute(sql`delete from address_search_cache where organisation_id = ${organisationId} and expires_at <= now()`);
  } catch {
    // Cache failures never prevent manual property entry or provider fallbacks.
  }
}

export async function searchAddresses(query: string, organisationId: string) {
  const normalisedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  const cacheHash = createHash("sha256").update(`${organisationId}:${normalisedQuery}`).digest("hex");
  const cacheKey = `property-data:address-search:${cacheHash}`;
  const cached = await readAddressCache(cacheKey, organisationId);
  if (typeof cached === "string") {
    try {
      const parsed = z.array(addressCandidateSchema).safeParse(JSON.parse(cached));
      if (parsed.success) return parsed.data;
    } catch {
      // A corrupt or outdated cache value is ignored and replaced below.
    }
  }
  const nominatimBaseUrl = process.env.NOMINATIM_BASE_URL;
  const publicNominatim = nominatimBaseUrl?.includes("nominatim.openstreetmap.org") ?? false;
  let nominatimAllowed = Boolean(nominatimBaseUrl && process.env.NOMINATIM_USER_AGENT);
  if (nominatimAllowed && publicNominatim) nominatimAllowed = await acquireProviderSlot("nominatim", 2);
  const [postcode, nominatim] = await Promise.allSettled([
    searchPostcode(query),
    nominatimAllowed ? searchNominatim(query, { baseUrl: nominatimBaseUrl, userAgent: process.env.NOMINATIM_USER_AGENT }) : Promise.resolve([]),
  ]);
  const candidates = [
    ...(postcode.status === "fulfilled" ? postcode.value : []),
    ...(nominatim.status === "fulfilled" ? nominatim.value : []),
  ];
  const seen = new Set<string>();
  const results = candidates.filter((candidate) => {
    const key = `${candidate.providerKey}:${candidate.sourceRecordId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
  const ttl = Math.max(60, Math.min(Number(process.env.ADDRESS_SEARCH_CACHE_TTL_SECONDS ?? 86_400), 604_800));
  await writeAddressCache(cacheKey, organisationId, results, Number.isFinite(ttl) ? ttl : 86_400);
  return results;
}

async function acquireProviderSlot(provider: string, seconds: number) {
  const result = await redisCommand(["SET", `property-data:rate:${provider}`, Date.now(), "NX", "EX", seconds]);
  if (result === "OK") return true;
  if (!process.env.DATABASE_ADMIN_URL) return false;
  try {
    const db = createDatabase(process.env.DATABASE_ADMIN_URL);
    const acquired = await db.execute(sql`
      insert into address_provider_rate_limits (provider, allowed_after, updated_at)
      values (${provider}, now() + (${seconds} * interval '1 second'), now())
      on conflict (provider) do update
      set allowed_after = excluded.allowed_after, updated_at = now()
      where address_provider_rate_limits.allowed_after <= now()
      returning provider
    `);
    return acquired.rows.length === 1;
  } catch {
    return false;
  }
}

export async function findNearbyUprns(latitude: number, longitude: number, limit = 8) {
  if (!process.env.DATABASE_APP_URL && !process.env.DATABASE_URL) return [];
  const db = createDatabase();
  const result = await db.execute(sql`
    select p.uprn,
      ST_Y(p.location) as latitude,
      ST_X(p.location) as longitude,
      ST_Distance(p.location::geography, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography) as distance_metres
    from os_uprn_points p
    join dataset_versions v on v.id = p.dataset_version_id and v.active = true
    where ST_DWithin(p.location::geography, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, 75)
    order by distance_metres asc
    limit ${Math.max(1, Math.min(limit, 20))}
  `);
  return (result.rows as Array<{ uprn: string; latitude: number | string; longitude: number | string; distance_metres: number | string }>).map((row) => ({
    uprn: row.uprn,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    distanceMetres: Math.round(Number(row.distance_metres) * 10) / 10,
  }));
}

export function resolveAddressCandidate(candidate: AddressCandidate, uprns: Awaited<ReturnType<typeof findNearbyUprns>>) {
  return {
    candidate,
    location: { latitude: candidate.latitude, longitude: candidate.longitude, precision: candidate.precision },
    uprnCandidates: uprns,
    requiresConfirmation: true,
    warning: candidate.precision === "postcode"
      ? "This is a postcode centroid. It is approximate and cannot establish the identity of a building."
      : uprns.length === 1
        ? "The nearby UPRN still requires surveyor confirmation against the address evidence."
        : "Multiple or no nearby UPRNs were found. Confirm the correct property before saving an identifier.",
  };
}

export async function enqueuePropertyIntelligence(input: { organisationId: string; propertyId: string; actorUserId: string | null; idempotencyKey: string }) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for intelligence queueing.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [property] = await db.select().from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.organisationId, input.organisationId))).limit(1);
  if (!property) return { kind: "missing" as const };
  if (!property.country || property.latitude === null || property.longitude === null) return { kind: "identity_required" as const };
  const location = propertyLocationSchema.parse({
    propertyId: property.id,
    country: property.country,
    uprn: property.uprn ?? undefined,
    latitude: property.latitude,
    longitude: property.longitude,
    address: [property.line1, property.line2, property.city, property.postcode].filter(Boolean).join(", "),
    propertyVersion: property.version,
  });
  const fingerprint = locationFingerprint(location);
  const [recent] = await db.select({ id: enrichmentRuns.id, idempotencyKey: enrichmentRuns.idempotencyKey, createdAt: enrichmentRuns.createdAt }).from(enrichmentRuns).where(and(eq(enrichmentRuns.organisationId, input.organisationId), eq(enrichmentRuns.propertyId, input.propertyId))).orderBy(desc(enrichmentRuns.createdAt)).limit(1);
  if (recent && recent.idempotencyKey !== input.idempotencyKey && recent.createdAt.getTime() > Date.now() - 60_000) return { kind: "rate_limited" as const, retryAfterSeconds: 60 };
  const [run] = await db.insert(enrichmentRuns).values({
    organisationId: input.organisationId,
    propertyId: input.propertyId,
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    propertyVersion: property.version,
    locationFingerprint: fingerprint,
  }).onConflictDoNothing().returning();
  if (!run) {
    const [existing] = await db.select().from(enrichmentRuns).where(and(eq(enrichmentRuns.organisationId, input.organisationId), eq(enrichmentRuns.idempotencyKey, input.idempotencyKey))).limit(1);
    return { kind: "queued" as const, run: existing, duplicate: true };
  }
  await db.insert(backgroundJobs).values({
    organisationId: input.organisationId,
    queue: "intelligence",
    type: intelligenceJobType,
    deduplicationKey: `intelligence:${run.id}`,
    payload: { runId: run.id, propertyId: property.id, organisationId: input.organisationId, location },
  });
  await db.insert(auditEvents).values({ organisationId: input.organisationId, actorUserId: input.actorUserId, action: "property_intelligence.refresh_queued", resourceType: "property", resourceId: property.id, metadata: { runId: run.id } });
  return { kind: "queued" as const, run, duplicate: false };
}

async function localSpatialResult(db: ReturnType<typeof createDatabase>, location: PropertyLocation, sourceKey: string, category: string, informationClass: "authoritative_external" | "indicative_external_context", caveat: string): Promise<ProviderResult> {
  const active = await db.select({ id: datasetVersions.id, version: datasetVersions.version }).from(datasetVersions).where(and(eq(datasetVersions.sourceKey, sourceKey), eq(datasetVersions.active, true))).limit(1);
  if (!active[0]) return { source: sourceKey, category, status: "not_configured", records: [], matchMethod: "point_intersection", confidence: 0, coverage: "unknown", informationClass, licence: "Open Government Licence v3.0", attribution: sourceRegistry.find((source) => source.key === sourceKey)?.organisation ?? sourceKey, retrievedAt: new Date().toISOString(), datasetVersion: null, safeError: null };
  const result = await db.execute(sql`
    select f.source_record_id, f.name, f.properties, ST_AsGeoJSON(f.geometry)::json as geometry
    from spatial_reference_features f
    where f.dataset_version_id = ${active[0].id}
      and f.source_key = ${sourceKey}
      and ST_Intersects(f.geometry, ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326))
    limit 100
  `);
  const records = (result.rows as Array<{ source_record_id: string; name: string | null; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }>).map((row) => ({
    sourceRecordId: row.source_record_id,
    title: row.name ?? sourceKey.replaceAll("_", " "),
    summary: caveat,
    data: row.properties,
    geometry: row.geometry,
    evidence: [],
  }));
  return { source: sourceKey, category, status: records.length ? "matched" : "no_match", records, matchMethod: "point_intersection", confidence: 0.95, coverage: "covered", informationClass, licence: "Open Government Licence v3.0", attribution: sourceRegistry.find((source) => source.key === sourceKey)?.organisation ?? sourceKey, retrievedAt: new Date().toISOString(), datasetVersion: active[0].version, safeError: null };
}

async function runProviders(db: ReturnType<typeof createDatabase>, location: PropertyLocation) {
  const epc = epcProvider({ email: process.env.EPC_API_EMAIL, apiKey: process.env.EPC_API_KEY, baseUrl: process.env.EPC_API_BASE_URL });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const providers: Array<{ source: string; category: string; informationClass: ProviderResult["informationClass"]; run: () => Promise<ProviderResult> }> = [
      { source: "planning_data", category: "planning", informationClass: "authoritative_external", run: () => planningDataProvider.fetch(location, controller.signal) },
      { source: "epc", category: "energy", informationClass: "authoritative_external", run: () => epc.fetch(location, controller.signal) },
      { source: "historic_england", category: "heritage", informationClass: "authoritative_external", run: () => localSpatialResult(db, location, "historic_england", "heritage", "authoritative_external", "National heritage designation; verify the source record.") },
      { source: "hmlr_inspire", category: "land", informationClass: "indicative_external_context", run: () => localSpatialResult(db, location, "hmlr_inspire", "land", "indicative_external_context", "Indicative registered extent—not a legal title boundary.") },
      { source: "ea_flood_zone_2", category: "environment", informationClass: "indicative_external_context", run: () => localSpatialResult(db, location, "ea_flood_zone_2", "environment", "indicative_external_context", "Flood Map for Planning context—not a property-specific risk assessment.") },
      { source: "ea_flood_zone_3", category: "environment", informationClass: "indicative_external_context", run: () => localSpatialResult(db, location, "ea_flood_zone_3", "environment", "indicative_external_context", "Flood Map for Planning context—not a property-specific risk assessment.") },
    ];
    return await Promise.all(providers.map(async (provider) => {
      try {
        return validateProviderResult(await provider.run());
      } catch {
        const source = sourceRegistry.find((entry) => entry.key === provider.source);
        return {
          source: provider.source,
          category: provider.category,
          status: "error" as const,
          records: [],
          matchMethod: "provider_query",
          confidence: 0,
          coverage: "unknown" as const,
          informationClass: provider.informationClass,
          licence: source?.licence ?? "Licence metadata unavailable",
          attribution: source?.organisation ?? provider.source,
          retrievedAt: new Date().toISOString(),
          datasetVersion: null,
          safeError: `${source?.name ?? provider.source} could not be checked.`,
        };
      }
    }));
  } finally {
    clearTimeout(timeout);
  }
}

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function processIntelligenceQueue(limit = 5) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for intelligence processing.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const now = new Date();
  const candidates = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue, "intelligence"), eq(backgroundJobs.status, "queued"), lte(backgroundJobs.availableAt, now), lt(backgroundJobs.attempts, maximumAttempts))).orderBy(asc(backgroundJobs.availableAt)).limit(Math.max(1, Math.min(limit, 10)) * 2);
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (claimed >= limit) break;
    const [job] = await db.update(backgroundJobs).set({ status: "processing", attempts: candidate.attempts + 1, error: null, updatedAt: new Date() }).where(and(eq(backgroundJobs.id, candidate.id), eq(backgroundJobs.status, "queued"))).returning();
    if (!job) continue;
    claimed += 1;
    const runId = typeof job.payload.runId === "string" ? job.payload.runId : null;
    try {
      if (!runId || job.type !== intelligenceJobType) throw new Error("Invalid intelligence job payload.");
      const [run] = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, runId)).limit(1);
      if (!run) throw new Error("Enrichment run no longer exists.");
      await db.update(enrichmentRuns).set({ status: "running", startedAt: new Date(), updatedAt: new Date() }).where(eq(enrichmentRuns.id, run.id));
      const [property] = await db.select().from(properties).where(and(eq(properties.id, run.propertyId), eq(properties.organisationId, run.organisationId))).limit(1);
      if (!property || !property.country || property.latitude === null || property.longitude === null) throw new Error("Property identity is no longer available.");
      const location = propertyLocationSchema.parse({ propertyId: property.id, country: property.country, uprn: property.uprn ?? undefined, latitude: property.latitude, longitude: property.longitude, address: [property.line1, property.line2, property.city, property.postcode].filter(Boolean).join(", "), propertyVersion: property.version });
      if (run.locationFingerprint !== locationFingerprint(location)) throw new Error("Property identity changed while intelligence was queued.");
      const results = await runProviders(db, location);
      const providerStatuses = Object.fromEntries(results.map((result) => [result.source, result.status]));
      const safeErrors = Object.fromEntries(results.flatMap((result) => result.safeError ? [[result.source, result.safeError]] : []));
      await db.transaction(async (tx) => {
        const [latest] = await tx.select({ version: properties.version, country: properties.country, latitude: properties.latitude, longitude: properties.longitude, uprn: properties.uprn }).from(properties).where(eq(properties.id, property.id)).limit(1);
        if (!latest || latest.version !== property.version || latest.country !== property.country || latest.latitude !== property.latitude || latest.longitude !== property.longitude || latest.uprn !== property.uprn) throw new Error("Property identity changed before intelligence could be saved.");
        for (const result of results) {
          await tx.insert(propertyIntelligenceSnapshots).values({
            organisationId: run.organisationId,
            propertyId: property.id,
            enrichmentRunId: run.id,
            sourceKey: result.source,
            datasetVersion: result.datasetVersion,
            category: result.category,
            data: { records: result.records },
            evidence: result.records.flatMap((record) => record.evidence),
            matchMethod: result.matchMethod,
            retrievedAt: safeDate(result.retrievedAt) ?? new Date(),
            sourceUpdatedAt: safeDate(result.records.map((record) => record.sourceUpdatedAt).find(Boolean)),
            expiresAt: safeDate(result.expiresAt),
            confidence: result.confidence,
            informationClass: result.informationClass,
            coverageStatus: result.coverage,
            resultStatus: result.status,
            licenceSnapshot: { licence: result.licence },
            attribution: result.attribution,
          });
        }
        const successful = results.filter((result) => result.status === "matched" || result.status === "no_match").length;
        const status = successful === results.length ? "completed" : successful ? "partial" : "failed";
        await tx.update(enrichmentRuns).set({ status, providerStatuses, safeErrors, completedAt: new Date(), updatedAt: new Date() }).where(eq(enrichmentRuns.id, run.id));
        await tx.insert(auditEvents).values({ organisationId: run.organisationId, actorUserId: run.actorUserId, action: `property_intelligence.${status}`, resourceType: "property", resourceId: property.id, metadata: { runId: run.id, providerStatuses } });
      });
      await db.update(backgroundJobs).set({ status: "completed", completedAt: new Date(), error: null, updatedAt: new Date() }).where(eq(backgroundJobs.id, job.id));
      completed += 1;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message.slice(0, 500) : "Unknown intelligence processing error";
      const exhausted = job.attempts >= maximumAttempts || message.includes("identity changed") || message.includes("no longer available");
      await db.update(backgroundJobs).set(exhausted ? { status: "failed", failedAt: new Date(), error: message, updatedAt: new Date() } : { status: "queued", availableAt: new Date(Date.now() + Math.min(2 ** job.attempts, 60) * 60_000), error: message, updatedAt: new Date() }).where(eq(backgroundJobs.id, job.id));
      if (runId) await db.update(enrichmentRuns).set({ status: exhausted ? "failed" : "queued", safeErrors: { orchestration: message }, completedAt: exhausted ? new Date() : null, updatedAt: new Date() }).where(eq(enrichmentRuns.id, runId));
      if (exhausted) failed += 1;
    }
  }
  return { claimed, completed, failed };
}

export async function loadPropertyIntelligence(organisationId: string, propertyId: string) {
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisationId}, true)`);
    const [property] = await tx.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.organisationId, organisationId))).limit(1);
    if (!property) return null;
    const runs = await tx.select().from(enrichmentRuns).where(and(eq(enrichmentRuns.propertyId, propertyId), eq(enrichmentRuns.organisationId, organisationId))).orderBy(desc(enrichmentRuns.createdAt)).limit(10);
    const currentFingerprint = property.country && property.latitude !== null && property.longitude !== null ? locationFingerprint({ country: property.country, uprn: property.uprn ?? undefined, latitude: property.latitude, longitude: property.longitude, propertyVersion: property.version }) : null;
    const currentRunIds = runs.filter((run) => run.locationFingerprint === currentFingerprint).map((run) => run.id);
    const snapshots = currentRunIds.length ? await tx.select().from(propertyIntelligenceSnapshots).where(and(eq(propertyIntelligenceSnapshots.propertyId, propertyId), eq(propertyIntelligenceSnapshots.organisationId, organisationId), inArray(propertyIntelligenceSnapshots.enrichmentRunId, currentRunIds))).orderBy(desc(propertyIntelligenceSnapshots.createdAt)) : [];
    const latestBySource = new Map<string, typeof snapshots[number]>();
    for (const snapshot of snapshots) if (!latestBySource.has(snapshot.sourceKey)) latestBySource.set(snapshot.sourceKey, snapshot);
    const sourceKeys = [...new Set(sourceRegistry.map((source) => source.key))];
    const sources = await tx.select().from(dataSources).where(inArray(dataSources.key, sourceKeys));
    return { property, runs, snapshots: [...latestBySource.values()], sources };
  });
}

export async function loadPropertyMap(organisationId: string, propertyId: string) {
  const intelligence = await loadPropertyIntelligence(organisationId, propertyId);
  if (!intelligence) return null;
  const features = intelligence.snapshots.flatMap((snapshot) => {
    const records = Array.isArray((snapshot.data as { records?: unknown[] }).records) ? (snapshot.data as { records: Array<Record<string, unknown>> }).records : [];
    return records.flatMap((record) => record.geometry && typeof record.geometry === "object" ? [{ type: "Feature" as const, geometry: record.geometry, properties: { sourceKey: snapshot.sourceKey, title: record.title, informationClass: snapshot.informationClass, resultStatus: snapshot.resultStatus } }] : []);
  });
  if (intelligence.property.latitude !== null && intelligence.property.longitude !== null) features.unshift({ type: "Feature", geometry: { type: "Point", coordinates: [intelligence.property.longitude, intelligence.property.latitude] }, properties: { sourceKey: "property", title: intelligence.property.line1, informationClass: "surveyor_verified", resultStatus: "matched" } });
  return { type: "FeatureCollection" as const, features };
}
