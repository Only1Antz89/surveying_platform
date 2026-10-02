import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm";
import { auditEvents, backgroundJobs, createDatabase, datasetSyncs, enrichmentRuns, properties, propertyIntelligenceSnapshots, withTenant, type TenantTransaction } from "@surveynt/db";
import { getSourceDefinition, intelligenceProviders, runProviders, sourceCoversCountry, sourceDefinitions, type IntelligenceProvider, type ProviderResult } from "@surveynt/property-data";
import { databaseHistoryQuery, databaseSpatialQuery, getSourceStates } from "@surveynt/property-data/importers";
import { intelligenceEnabled } from "./property-identity";
import { databasePublicCache } from "./provider-cache";
import { propertyFingerprint, toLocation } from "./fingerprint";
import { refreshProposalsForProperty } from "./proposals";

export { propertyFingerprint };

const QUEUE = "property_intelligence";
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 4;
const REUSE_WINDOW_MS = 10 * 60_000;

type TenantContext = { organisationId: string; internalUserId: string | null };


export type RefreshOutcome =
  | { kind: "disabled" }
  | { kind: "missing" }
  | { kind: "queued"; run: typeof enrichmentRuns.$inferSelect }
  | { kind: "existing"; run: typeof enrichmentRuns.$inferSelect };

/**
 * Creates (or reuses) an enrichment run and its durable job in one tenant
 * transaction. Repeated requests with the same idempotency key, or for an
 * unchanged property within a short window, return the existing run.
 */
export async function requestIntelligenceRefresh(context: TenantContext, propertyId: string, input: { idempotencyKey?: string } = {}): Promise<RefreshOutcome> {
  if (!intelligenceEnabled()) return { kind: "disabled" };
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const [property] = await tx.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!property) return { kind: "missing" };
    const fingerprint = await propertyFingerprint(property);
    if (input.idempotencyKey) {
      const [existing] = await tx.select().from(enrichmentRuns).where(and(eq(enrichmentRuns.organisationId, context.organisationId), eq(enrichmentRuns.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return { kind: "existing", run: existing };
    }
    const [recent] = await tx.select().from(enrichmentRuns).where(and(eq(enrichmentRuns.organisationId, context.organisationId), eq(enrichmentRuns.propertyId, propertyId), eq(enrichmentRuns.inputFingerprint, fingerprint))).orderBy(desc(enrichmentRuns.createdAt)).limit(1);
    if (recent && (recent.status === "queued" || recent.status === "running" || Date.now() - recent.createdAt.getTime() < REUSE_WINDOW_MS)) return { kind: "existing", run: recent };
    const [run] = await tx.insert(enrichmentRuns).values({ organisationId: context.organisationId, propertyId, actorUserId: context.internalUserId, idempotencyKey: input.idempotencyKey ?? `refresh:${crypto.randomUUID()}`, inputFingerprint: fingerprint, propertyVersion: property.version }).returning();
    await tx.insert(backgroundJobs).values({ organisationId: context.organisationId, queue: QUEUE, type: "enrich_property", deduplicationKey: `intelligence:${run.id}`, payload: { runId: run.id } });
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "property.intelligence_refresh_requested", resourceType: "property", resourceId: propertyId, metadata: { runId: run.id } });
    return { kind: "queued", run };
  });
}

type SnapshotInsert = typeof propertyIntelligenceSnapshots.$inferInsert;

function snapshotRows(organisationId: string, propertyId: string, runId: string, fingerprint: string, results: ProviderResult[]): SnapshotInsert[] {
  return results.flatMap((item): SnapshotInsert[] => {
    const base = {
      organisationId, propertyId, enrichmentRunId: runId, sourceKey: item.source, datasetVersion: item.datasetVersion, category: item.category,
      informationClass: item.informationClass, coverageStatus: item.coverage, resultStatus: item.status, message: item.message,
      licence: item.licence as unknown as Record<string, unknown>, inputFingerprint: fingerprint, retrievedAt: new Date(item.retrievedAt),
      expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
    };
    if (!item.records.length) return [{ ...base, matchMethod: "none", data: {}, evidence: [] }];
    return item.records.map((record) => ({
      ...base, sourceRecordId: record.sourceRecordId, data: record.data, evidence: record.evidence, matchMethod: record.matchMethod, confidence: record.confidence,
      sourceUpdatedAt: record.sourceUpdatedAt && !Number.isNaN(Date.parse(record.sourceUpdatedAt)) ? new Date(record.sourceUpdatedAt) : null,
    }));
  });
}

function runStatus(results: ProviderResult[]) {
  if (!results.length) return "completed";
  const failed = results.filter((item) => item.status === "error" || item.status === "unavailable").length;
  if (failed === 0) return "completed";
  return failed === results.length ? "failed" : "partial";
}

async function claimJob(tx: TenantTransaction, runId: string) {
  const now = new Date();
  const [job] = await tx.update(backgroundJobs).set({ status: "processing", attempts: sql`${backgroundJobs.attempts} + 1`, lockedUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now })
    .where(and(eq(backgroundJobs.queue, QUEUE), eq(backgroundJobs.deduplicationKey, `intelligence:${runId}`), lte(backgroundJobs.availableAt, now),
      or(eq(backgroundJobs.status, "queued"), and(eq(backgroundJobs.status, "processing"), lte(backgroundJobs.lockedUntil, now)))))
    .returning();
  return job ?? null;
}

/**
 * Processes one run. Safe to call repeatedly and concurrently: only the worker
 * holding the lease proceeds. Results for a property whose identity changed
 * are kept against the old input and the run is marked superseded, never current.
 */
export async function processIntelligenceRun(organisationId: string, runId: string, options: { providers?: IntelligenceProvider[]; fetchImpl?: typeof fetch } = {}) {
  const db = createDatabase();
  const claimed = await withTenant(db, organisationId, async (tx) => {
    const job = await claimJob(tx, runId);
    if (!job) return null;
    const [run] = await tx.select().from(enrichmentRuns).where(and(eq(enrichmentRuns.id, runId), eq(enrichmentRuns.organisationId, organisationId))).limit(1);
    const [property] = run ? await tx.select().from(properties).where(and(eq(properties.id, run.propertyId), eq(properties.organisationId, organisationId))).limit(1) : [];
    return { job, run, property };
  });
  if (!claimed?.run || !claimed.property) return { processed: false as const };
  const { job, run, property } = claimed;
  const finishJob = (status: "completed" | "queued" | "failed", error?: string) => withTenant(db, organisationId, (tx) => tx.update(backgroundJobs).set(status === "queued"
    ? { status, lockedUntil: null, availableAt: new Date(Date.now() + Math.min(2 ** job.attempts, 30) * 60_000), error: error ?? null, updatedAt: new Date() }
    : { status, lockedUntil: null, ...(status === "completed" ? { completedAt: new Date() } : { failedAt: new Date() }), error: error ?? null, updatedAt: new Date() }).where(eq(backgroundJobs.id, job.id)));
  if (["completed", "partial", "failed", "superseded"].includes(run.status)) {
    await finishJob("completed");
    return { processed: false as const, status: run.status };
  }
  const fingerprint = await propertyFingerprint(property);
  if (fingerprint !== run.inputFingerprint) {
    await withTenant(db, organisationId, (tx) => tx.update(enrichmentRuns).set({ status: "superseded", completedAt: new Date(), error: "The property's location or identity changed before this run started.", updatedAt: new Date() }).where(eq(enrichmentRuns.id, run.id)));
    await finishJob("completed");
    return { processed: true as const, status: "superseded" };
  }
  try {
    await withTenant(db, organisationId, (tx) => tx.update(enrichmentRuns).set({ status: "running", startedAt: new Date(), updatedAt: new Date() }).where(eq(enrichmentRuns.id, run.id)));
    const providers = options.providers ?? intelligenceProviders;
    const enabled = await getSourceStates(db, providers.map((provider) => provider.key));
    const active = providers.filter((provider) => enabled[provider.key]);
    const outcomes = await runProviders(active, toLocation(property), { now: new Date(), env: process.env, fetchImpl: options.fetchImpl, spatial: databaseSpatialQuery(db), history: databaseHistoryQuery(db), cache: databasePublicCache(db) }, { concurrency: 3, timeoutMs: 20_000 });
    const results = outcomes.flatMap((outcome) => outcome.results);
    const providerStatuses = Object.fromEntries([
      ...providers.filter((provider) => !enabled[provider.key]).map((provider) => [provider.key, { status: "not_configured", message: "Source not enabled after verification." }]),
      ...outcomes.map((outcome) => [outcome.providerKey, { statuses: [...new Set(outcome.results.map((item) => item.status))], durationMs: outcome.durationMs, errors: outcome.results.filter((item) => item.errorCode).map((item) => item.errorCode) }]),
    ]);
    const status = await withTenant(db, organisationId, async (tx) => {
      const [current] = await tx.select().from(properties).where(and(eq(properties.id, property.id), eq(properties.organisationId, organisationId))).limit(1);
      const stillCurrent = current && (await propertyFingerprint(current)) === run.inputFingerprint;
      const rows = snapshotRows(organisationId, property.id, run.id, run.inputFingerprint, results);
      if (rows.length) await tx.insert(propertyIntelligenceSnapshots).values(rows);
      const finalStatus = stillCurrent ? runStatus(results) : "superseded";
      await tx.update(enrichmentRuns).set({ status: finalStatus, providerStatuses, completedAt: new Date(), updatedAt: new Date(), error: stillCurrent ? null : "The property's location or identity changed while this run was in progress; results were kept against the earlier input." }).where(eq(enrichmentRuns.id, run.id));
      return finalStatus;
    });
    await finishJob("completed");
    // Event-driven assistant refresh: new or changed records may create proposals or discrepancies.
    if (status !== "superseded") await refreshProposalsForProperty(organisationId, property.id).catch(() => 0);
    return { processed: true as const, status };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message.slice(0, 500) : "Unexpected error";
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await withTenant(db, organisationId, (tx) => tx.update(enrichmentRuns).set(exhausted ? { status: "failed", error: "The refresh could not be completed. Try again later.", completedAt: new Date(), updatedAt: new Date() } : { status: "queued", updatedAt: new Date() }).where(eq(enrichmentRuns.id, run.id)));
    await finishJob(exhausted ? "failed" : "queued", message);
    return { processed: true as const, status: exhausted ? "failed" : "queued" };
  }
}

/** Sweeps due or abandoned intelligence jobs across firms (cron and queue consumer). Uses the owner connection only to find work. */
export async function processIntelligenceQueue(limit = 10) {
  if (!process.env.DATABASE_ADMIN_URL) return { claimed: 0, results: [] };
  const admin = createDatabase(process.env.DATABASE_ADMIN_URL);
  const now = new Date();
  const due = await admin.select({ organisationId: backgroundJobs.organisationId, payload: backgroundJobs.payload }).from(backgroundJobs)
    .where(and(eq(backgroundJobs.queue, QUEUE), lte(backgroundJobs.availableAt, now), or(eq(backgroundJobs.status, "queued"), and(eq(backgroundJobs.status, "processing"), lte(backgroundJobs.lockedUntil, now)))))
    .orderBy(asc(backgroundJobs.availableAt)).limit(Math.max(1, Math.min(limit, 50)));
  const results = [];
  for (const job of due) {
    const runId = typeof job.payload.runId === "string" ? job.payload.runId : null;
    if (!job.organisationId || !runId) continue;
    results.push({ runId, ...(await processIntelligenceRun(job.organisationId, runId)) });
  }
  return { claimed: results.length, results };
}

export type IntelligenceCategoryView = {
  /** A newer version of the imported dataset is active; refreshing would use it. */
  newerDataAvailable?: boolean;
  sourceKey: string;
  category: string;
  status: string;
  informationClass: string;
  coverage: string;
  message: string | null;
  retrievedAt: string;
  expiresAt: string | null;
  datasetVersion: string | null;
  fresh: boolean;
  stale: boolean;
  licence: Record<string, unknown>;
  records: { snapshotId: string; sourceRecordId: string | null; data: Record<string, unknown>; evidence: { label: string; url: string }[]; matchMethod: string; confidence: string | null; sourceUpdatedAt: string | null }[];
};

/** Latest permitted snapshots per source and category, with freshness and stale-identity flags, plus source metadata. */
export async function loadPropertyIntelligence(context: TenantContext, propertyId: string) {
  const db = createDatabase();
  const data = await withTenant(db, context.organisationId, async (tx) => {
    const [property] = await tx.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!property) return null;
    const runs = await tx.select().from(enrichmentRuns).where(and(eq(enrichmentRuns.organisationId, context.organisationId), eq(enrichmentRuns.propertyId, propertyId))).orderBy(desc(enrichmentRuns.createdAt)).limit(10);
    const snapshots = await tx.select().from(propertyIntelligenceSnapshots).where(and(eq(propertyIntelligenceSnapshots.organisationId, context.organisationId), eq(propertyIntelligenceSnapshots.propertyId, propertyId))).orderBy(desc(propertyIntelligenceSnapshots.retrievedAt)).limit(1000);
    return { property, runs, snapshots };
  });
  if (!data) return null;
  const fingerprint = await propertyFingerprint(data.property);
  const usableRuns = new Set(data.runs.filter((run) => run.status !== "superseded").map((run) => run.id));
  const groups = new Map<string, typeof data.snapshots>();
  for (const snapshot of data.snapshots) {
    const key = `${snapshot.sourceKey}|${snapshot.category}`;
    const existing = groups.get(key);
    if (!existing) { groups.set(key, [snapshot]); continue; }
    if (existing[0].enrichmentRunId === snapshot.enrichmentRunId) existing.push(snapshot);
  }
  const now = Date.now();
  // Dataset versions now active, to flag results built from an older import (cache invalidation for stored snapshots).
  const activeRows = await db.select({ sourceKey: datasetSyncs.sourceKey, datasetVersion: datasetSyncs.datasetVersion }).from(datasetSyncs).where(eq(datasetSyncs.status, "active"));
  const activeVersions = (key: string) => new Set(activeRows.filter((row) => row.sourceKey === key).map((row) => row.datasetVersion));
  const newerDataAvailable = (sourceKey: string, version: string | null) => {
    if (!version || getSourceDefinition(sourceKey)?.accessMethod !== "bulk_import") return false;
    const linked = /^(.*) \(look-up (.*)\)$/.exec(version);
    if (linked && sourceKey === "hmlr_price_paid") return !activeVersions("hmlr_price_paid").has(linked[1]) || !activeVersions("hmlr_ppd_uprn_lookup").has(linked[2]);
    return !activeVersions(sourceKey).has(version);
  };
  const categories: IntelligenceCategoryView[] = [...groups.values()].map((rows) => {
    const head = rows[0];
    return {
      sourceKey: head.sourceKey, category: head.category, status: head.resultStatus, informationClass: head.informationClass, coverage: head.coverageStatus, message: head.message,
      retrievedAt: head.retrievedAt.toISOString(), expiresAt: head.expiresAt?.toISOString() ?? null, datasetVersion: head.datasetVersion,
      fresh: Boolean(head.expiresAt && head.expiresAt.getTime() > now),
      stale: head.inputFingerprint !== fingerprint || !usableRuns.has(head.enrichmentRunId),
      newerDataAvailable: newerDataAvailable(head.sourceKey, head.datasetVersion),
      licence: head.licence,
      records: head.resultStatus === "matched" ? rows.map((row) => ({ snapshotId: row.id, sourceRecordId: row.sourceRecordId, data: row.data, evidence: row.evidence, matchMethod: row.matchMethod, confidence: row.confidence, sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null })) : [],
    };
  });
  const enabled = await getSourceStates(db, sourceDefinitions.map((source) => source.key));
  const latestRun = data.runs[0];
  return {
    enabled: intelligenceEnabled(),
    fingerprint,
    location: { country: data.property.country, confidence: data.property.locationConfidence, uprnConfirmed: Boolean(data.property.uprn) },
    latestRun: latestRun ? { id: latestRun.id, status: latestRun.status, createdAt: latestRun.createdAt.toISOString(), completedAt: latestRun.completedAt?.toISOString() ?? null, error: latestRun.error, current: latestRun.inputFingerprint === fingerprint } : null,
    categories,
    sources: sourceDefinitions.map((source) => ({
      key: source.key, name: source.name, organisation: source.organisation, category: source.category, registerStatus: source.registerStatus, enabled: Boolean(enabled[source.key]),
      coversProperty: sourceCoversCountry(source, data.property.country), coverage: source.coverage, coverageNotes: source.coverageNotes, licence: source.licence, documentationUrl: source.documentationUrl,
      refreshDays: source.refreshPolicy.days, guardrail: source.guardrail, checkedAt: source.checkedAt,
    })),
  };
}

export type PropertyIntelligence = NonNullable<Awaited<ReturnType<typeof loadPropertyIntelligence>>>;

export async function loadRunStatus(context: TenantContext, runId: string) {
  const db = createDatabase();
  const [run] = await withTenant(db, context.organisationId, (tx) => tx.select({ id: enrichmentRuns.id, status: enrichmentRuns.status, propertyId: enrichmentRuns.propertyId, completedAt: enrichmentRuns.completedAt, error: enrichmentRuns.error, providerStatuses: enrichmentRuns.providerStatuses }).from(enrichmentRuns).where(and(eq(enrichmentRuns.id, runId), eq(enrichmentRuns.organisationId, context.organisationId))).limit(1));
  return run ?? null;
}
