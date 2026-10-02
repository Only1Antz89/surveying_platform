import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dataSources, providerResponseCache } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { activateSyncAndInvalidate, loadSourceOperations, OperationRefused, recordProbe, recordReleaseCheck, rollbackAndInvalidate, setSourceEnablement, sourcesToProbe, staleSources } from "../src/db/operations";
import { syncSourceRegistry } from "../src/db/reference";
import { importSpatialLayer } from "../src/importers/spatial-layer";
import { probeSource } from "../src/operations/probes";

const square = { type: "FeatureCollection", features: [{ type: "Feature", properties: { fid: "fz3-1", flood_zone: "3" }, geometry: { type: "Polygon", coordinates: [[[-2.602, 51.45], [-2.6, 51.45], [-2.6, 51.452], [-2.602, 51.452], [-2.602, 51.45]]] } }] };

async function expectDenied(work: Promise<unknown>) {
  const error = await work.then(() => null, (reason) => reason);
  expect(error, "expected the database to refuse").not.toBeNull();
  expect(String(error?.cause?.message ?? error?.message)).toMatch(/permission denied/);
}

describe.skipIf(!integrationEnabled)("data source operations", () => {
  let database: TestDatabase;
  let file = "";

  beforeAll(async () => {
    database = await createTestDatabase();
    await syncSourceRegistry(database.connect(database.adminUrl));
    const directory = await mkdtemp(path.join(tmpdir(), "surveynt-ops-"));
    file = path.join(directory, "fz3.geojson");
    await writeFile(file, JSON.stringify(square));
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("enables only verified, unblocked sources and records who verified them", async () => {
    const admin = database.connect(database.adminUrl);
    await expect(setSourceEnablement(admin, "ea_flood_zones", { enabled: true, actor: "platform:test", notes: "ok" })).rejects.toThrow(OperationRefused);
    await expect(setSourceEnablement(admin, "bgs_geology_50k", { enabled: true, actor: "platform:test", notes: "Licence checked thoroughly on the official page." })).rejects.toThrow(/blocked/);
    await setSourceEnablement(admin, "ea_flood_zones", { enabled: true, actor: "platform:test", notes: "OGL confirmed on the Defra dataset page, 2 Oct 2026." });
    const view = await loadSourceOperations(admin);
    expect(view.find((source) => source.key === "ea_flood_zones")).toMatchObject({ enabled: true, verifiedBy: "platform:test", freshness: { state: "not_imported" } });
    await setSourceEnablement(admin, "ea_flood_zones", { enabled: false, actor: "platform:test" });
    expect((await loadSourceOperations(admin)).find((source) => source.key === "ea_flood_zones")?.enabled).toBe(false);
    await setSourceEnablement(admin, "ea_flood_zones", { enabled: true, actor: "platform:test", notes: "OGL confirmed on the Defra dataset page, 2 Oct 2026." });
  });

  it("activates and rolls back versions while clearing cached responses, and tracks freshness", async () => {
    const admin = database.connect(database.adminUrl);
    const importer = database.connect(database.importerUrl);
    const first = await importSpatialLayer(importer, { sourceKey: "ea_flood_zones", layer: "flood_zone_3", filePath: file, datasetVersion: "2026-08", activate: true, importedBy: "test" });
    const second = await importSpatialLayer(importer, { sourceKey: "ea_flood_zones", layer: "flood_zone_3", filePath: file, datasetVersion: "2026-09", importedBy: "test" });
    expect([first.status, second.status]).toEqual(["active", "staging"]);
    await admin.insert(providerResponseCache).values([
      { cacheKey: "k1", sourceKey: "ea_flood_zones", response: { value: 1 }, expiresAt: new Date(Date.now() + 86_400_000) },
      { cacheKey: "k2", sourceKey: "postcodes_io", response: { value: 2 }, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    // The importer (CLI) activates and clears the public cache; it cannot add cache entries.
    const activated = await activateSyncAndInvalidate(importer, second.syncId);
    await expectDenied(importer.insert(providerResponseCache).values({ cacheKey: "k3", sourceKey: "ea_flood_zones", response: { value: 3 }, expiresAt: new Date() }));
    expect(activated).toMatchObject({ activated: { datasetVersion: "2026-09" }, invalidated: 1 });
    expect((await admin.select().from(providerResponseCache)).map((row) => row.sourceKey)).toEqual(["postcodes_io"]);
    const view = (await loadSourceOperations(admin)).find((source) => source.key === "ea_flood_zones")!;
    expect(view.active.map((sync) => `${sync.layer}:${sync.datasetVersion}`)).toEqual(["flood_zone_3:2026-09"]);
    expect(view.freshness.state).toBe("current");
    expect(view.history.map((sync) => sync.status).sort()).toEqual(["active", "retired"]);
    // Ninety-one days later, with no new import or release check, the source is due a check; recording one resets it.
    const later = new Date(Date.now() + 91 * 86_400_000);
    expect(await staleSources(admin, later)).toEqual([{ key: "ea_flood_zones", dueAt: expect.any(String) }]);
    await admin.update(dataSources).set({ lastReleaseCheckAt: new Date(later.getTime() - 86_400_000) }).where(eq(dataSources.key, "ea_flood_zones"));
    expect(await staleSources(admin, later)).toEqual([]);
    await expect(recordReleaseCheck(admin, "ea_flood_zones", { actor: "platform:test", note: "short" })).rejects.toThrow(OperationRefused);
    await recordReleaseCheck(admin, "ea_flood_zones", { actor: "platform:test", note: "No newer release on the Defra page." });
    const rolledBack = await rollbackAndInvalidate(importer, "ea_flood_zones", "flood_zone_3");
    expect(rolledBack.restored.datasetVersion).toBe("2026-08");
  });

  it("records probes and only probes enabled live APIs", async () => {
    const admin = database.connect(database.adminUrl);
    const ok = await probeSource("postcodes_io", {}, async () => new Response(JSON.stringify({ status: 200 }), { status: 200, headers: { "content-type": "application/json" } }));
    const failed = await probeSource("planning_data", {}, async () => { throw new TypeError("network down"); });
    expect([ok.status, failed.status]).toEqual(["ok", "failed"]);
    expect(await probeSource("nominatim", {})).toMatchObject({ status: "not_probed" });
    expect(await probeSource("ea_flood_zones", {})).toMatchObject({ status: "not_probed" });
    await recordProbe(admin, "postcodes_io", ok);
    await recordProbe(admin, "planning_data", failed);
    const view = await loadSourceOperations(admin);
    expect(view.find((source) => source.key === "postcodes_io")?.probe).toMatchObject({ status: "ok" });
    expect(view.find((source) => source.key === "planning_data")?.probe).toMatchObject({ status: "failed" });
    // Planning Data is enabled and verified by the England release's seed (migration 0006).
    expect(await sourcesToProbe(admin)).toEqual(["planning_data"]);
    await setSourceEnablement(admin, "postcodes_io", { enabled: true, actor: "platform:test", notes: "Terms and endpoint confirmed on postcodes.io docs." });
    expect((await sourcesToProbe(admin)).sort()).toEqual(["planning_data", "postcodes_io"]);
  });

  it("keeps operator metadata out of reach of the app and importer roles", async () => {
    expect(await database.connect(database.appUrl).update(dataSources).set({ lastReleaseCheckAt: new Date() }).where(eq(dataSources.key, "ea_flood_zones")).returning()).toEqual([]);
    await expectDenied(database.connect(database.importerUrl).update(dataSources).set({ lastProbeStatus: "ok" }).where(eq(dataSources.key, "postcodes_io")));
  });
});
