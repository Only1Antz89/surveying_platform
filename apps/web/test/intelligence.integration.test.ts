import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { backgroundJobs, clients, referenceDataSources, enrichmentRuns, organisations, properties, propertyIntelligenceSnapshots } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { importSpatialLayer, syncSourceRegistry } from "@surveynt/property-data/importers";
import { loadPropertyIntelligence, loadRunStatus, processIntelligenceQueue, processIntelligenceRun, requestIntelligenceRefresh } from "../src/lib/intelligence";

const firmA = "00000000-0000-0000-0000-0000000000a4";
const firmB = "00000000-0000-0000-0000-0000000000b4";
const point = { latitude: 51.4544, longitude: -2.6198 };
const square = (lat: number, lon: number, half: number) => [[[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]]];

// Synthetic test layer shaped like Historic England listed building polygons; not real list entries.
const listedLayer = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { ListEntry: 9000001, Name: "TEST ONLY terrace", Grade: "II*", Address: "should not be stored" }, geometry: { type: "Polygon", coordinates: square(point.latitude, point.longitude, 0.0002) } },
  { type: "Feature", properties: { ListEntry: 9000002, Name: "TEST ONLY railings", Grade: "II" }, geometry: { type: "Polygon", coordinates: square(point.latitude + 0.0003, point.longitude, 0.00005) } },
  { type: "Feature", properties: { ListEntry: 9000003, Name: "TEST ONLY far away", Grade: "II" }, geometry: { type: "Polygon", coordinates: square(point.latitude + 0.01, point.longitude, 0.0001) } },
] };

const planningFixture = { entities: [{ entity: 44000123, dataset: "conservation-area", name: "TEST conservation area", "entry-date": "2023-02-01" }] };

function stubFetch(epcStatus: number) {
  return vi.fn(async (url: URL | RequestInfo) => {
    const host = new URL(String(url)).hostname;
    if (host === "www.planning.data.gov.uk") return new Response(JSON.stringify(planningFixture), { status: 200, headers: { "content-type": "application/json" } });
    if (host === "epc.example.test") return new Response("{}", { status: epcStatus });
    throw new Error(`unexpected host ${host}`);
  });
}

describe.skipIf(!integrationEnabled)("property intelligence", () => {
  let database: TestDatabase;
  let propertyId = "";
  const context = { organisationId: firmA, internalUserId: null };

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, PROPERTY_INTELLIGENCE_ENABLED: "true", EPC_API_BASE_URL: "https://epc.example.test", EPC_API_TOKEN: "test-token", EPC_LICENCE_ACCEPTED: "true", EPC_DATA_PROTECTION_APPROVED: "true" });
    const admin = database.connect(database.adminUrl);
    await syncSourceRegistry(admin);
    await admin.update(referenceDataSources).set({ enabled: true, verifiedAt: new Date(), verifiedBy: "integration-test" }).where(sql`${referenceDataSources.key} in ('planning_data', 'epc_england_wales', 'historic_england_nhle')`);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a4", name: "Firm A", slug: "firm-a4", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b4", name: "Firm B", slug: "firm-b4", practiceType: "residential", region: "Leeds" },
    ]);
    const [client] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: client.id, line1: "1 Test Crescent", city: "Bristol", postcode: "BS8 4JX", country: "ENG", ...point, locationConfidence: "surveyor_confirmed", uprn: "990000000004", uprnConfirmedAt: new Date(), uprnEvidenceType: "site_inspection" }).returning();
    propertyId = property.id;
    const directory = await mkdtemp(path.join(tmpdir(), "surveynt-layer-"));
    const file = path.join(directory, "listed.geojson");
    await writeFile(file, JSON.stringify(listedLayer));
    const outcome = await importSpatialLayer(database.connect(database.importerUrl), { sourceKey: "historic_england_nhle", layer: "listed_building", filePath: file, datasetVersion: "synthetic-1", activate: true, importedBy: "test" });
    expect(outcome).toMatchObject({ status: "active", recordCount: 3 });
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("deduplicates refresh requests and keeps partial results when one provider fails", async () => {
    const first = await requestIntelligenceRefresh(context, propertyId, { idempotencyKey: "refresh_test_0001" });
    expect(first.kind).toBe("queued");
    const again = await requestIntelligenceRefresh(context, propertyId, { idempotencyKey: "refresh_test_0001" });
    const unchanged = await requestIntelligenceRefresh(context, propertyId);
    if (first.kind !== "queued" || again.kind !== "existing" || unchanged.kind !== "existing") throw new Error("unexpected refresh outcomes");
    expect(again.run.id).toBe(first.run.id);
    expect(unchanged.run.id).toBe(first.run.id);
    const fetchImpl = stubFetch(503);
    const [one, two] = await Promise.all([processIntelligenceRun(firmA, first.run.id, { fetchImpl }), processIntelligenceRun(firmA, first.run.id, { fetchImpl })]);
    expect([one.processed, two.processed].filter(Boolean)).toHaveLength(1);
    const run = await loadRunStatus(context, first.run.id);
    expect(run?.status).toBe("partial");
    const intelligence = await loadPropertyIntelligence(context, propertyId);
    const byCategory = (category: string) => intelligence!.categories.find((item) => item.category === category);
    expect(byCategory("conservation_area")).toMatchObject({ status: "matched", stale: false, fresh: true, informationClass: "authoritative_external" });
    expect(byCategory("green_belt")).toMatchObject({ status: "no_match" });
    expect(byCategory("energy_certificate")).toMatchObject({ status: "unavailable" });
    expect(byCategory("listed_building_nhle")).toMatchObject({ status: "matched", datasetVersion: "synthetic-1" });
    expect(byCategory("listed_building_nhle")!.records[0].data).toMatchObject({ name: "TEST ONLY terrace", attributes: { Grade: "II*", ListEntry: 9000001 } });
    expect(JSON.stringify(byCategory("listed_building_nhle"))).not.toContain("should not be stored");
    expect(byCategory("listed_building_nhle_nearby")!.records.map((record) => record.sourceRecordId)).toEqual(["9000002"]);
    expect(byCategory("scheduled_monument_nhle")).toMatchObject({ status: "not_configured", coverage: "unknown" });
    expect(intelligence!.sources.find((source) => source.key === "planning_data")).toMatchObject({ enabled: true, coversProperty: true });
    expect(intelligence!.sources.find((source) => source.key === "bgs_geology_50k")).toMatchObject({ enabled: false, registerStatus: "blocked" });
  });

  it("keeps snapshots immutable", async () => {
    const admin = database.connect(database.adminUrl);
    const [snapshot] = await admin.select().from(propertyIntelligenceSnapshots).limit(1);
    await expect(admin.update(propertyIntelligenceSnapshots).set({ message: "edited" }).where(eq(propertyIntelligenceSnapshots.id, snapshot.id))).rejects.toThrow();
  });

  it("marks results stale when identity changes and supersedes runs queued for the old identity", async () => {
    const admin = database.connect(database.adminUrl);
    const moveTo = (latitude: number) => admin.update(properties).set({ latitude, version: sql`${properties.version} + 1` }).where(eq(properties.id, propertyId));
    await moveTo(51.4545);
    const queued = await requestIntelligenceRefresh(context, propertyId, { idempotencyKey: "refresh_test_0002" });
    if (queued.kind !== "queued") throw new Error("expected a queued run");
    await moveTo(51.4546);
    const intelligence = await loadPropertyIntelligence(context, propertyId);
    expect(intelligence!.categories.every((item) => item.stale)).toBe(true);
    const fetchImpl = stubFetch(200);
    const outcome = await processIntelligenceRun(firmA, queued.run.id, { fetchImpl });
    expect(outcome).toMatchObject({ processed: true, status: "superseded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reclaims abandoned work after the lease expires", async () => {
    const admin = database.connect(database.adminUrl);
    await admin.update(properties).set({ latitude: 51.4547, version: sql`${properties.version} + 1` }).where(eq(properties.id, propertyId));
    const queued = await requestIntelligenceRefresh(context, propertyId, { idempotencyKey: "refresh_test_0003" });
    if (queued.kind !== "queued") throw new Error("expected a queued run");
    await admin.update(backgroundJobs).set({ status: "processing", lockedUntil: new Date(Date.now() - 1000) }).where(eq(backgroundJobs.deduplicationKey, `intelligence:${queued.run.id}`));
    vi.stubGlobal("fetch", stubFetch(200));
    const sweep = await processIntelligenceQueue(5);
    vi.unstubAllGlobals();
    expect(sweep.results.find((item) => item.runId === queued.run.id)).toMatchObject({ processed: true });
    const [run] = await admin.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, queued.run.id));
    expect(["completed", "partial"]).toContain(run.status);
  });

  it("never exposes another firm's intelligence or runs", async () => {
    const other = { organisationId: firmB, internalUserId: null };
    expect(await loadPropertyIntelligence(other, propertyId)).toBeNull();
    const admin = database.connect(database.adminUrl);
    const [run] = await admin.select().from(enrichmentRuns).limit(1);
    expect(await loadRunStatus(other, run.id)).toBeNull();
    expect(await requestIntelligenceRefresh(other, propertyId)).toEqual({ kind: "missing" });
  });
});
