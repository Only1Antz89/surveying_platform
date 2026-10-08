import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents, clients, organisations, platformStaff, properties } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { historicEnglandProvider } from "@surveynt/property-data";
import { importSpatialLayer, syncSourceRegistry } from "@surveynt/property-data/importers";
import { activateDataSourceSync, applyDataSourceAction, loadDataSourceAdmin, OperationRefused, runDataSourceSweep } from "../src/lib/data-source-admin";
import { loadPropertyIntelligence, processIntelligenceRun, requestIntelligenceRefresh } from "../src/lib/intelligence";

const firm = "00000000-0000-0000-0000-0000000000a9";
const point = { latitude: 51.4544, longitude: -2.6198 };
const layer = (version: string) => JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { ListEntry: 9000001, Name: `TEST ONLY terrace ${version}`, Grade: "II" }, geometry: { type: "Polygon", coordinates: [[[point.longitude - 0.0002, point.latitude - 0.0002], [point.longitude + 0.0002, point.latitude - 0.0002], [point.longitude + 0.0002, point.latitude + 0.0002], [point.longitude - 0.0002, point.latitude + 0.0002], [point.longitude - 0.0002, point.latitude - 0.0002]]] } }] });

describe.skipIf(!integrationEnabled)("data source administration", () => {
  let database: TestDatabase;
  let propertyId = "";
  let operator = { platformStaffId: "", userId: "user_ops" };
  let directory = "";

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, PROPERTY_INTELLIGENCE_ENABLED: "true" });
    const admin = database.connect(database.adminUrl);
    await syncSourceRegistry(admin);
    const [staff] = await admin.insert(platformStaff).values({ clerkUserId: "user_ops", role: "compliance" }).returning();
    operator = { platformStaffId: staff.id, userId: "user_ops" };
    await admin.insert(organisations).values({ id: firm, clerkOrganisationId: "org_a9", name: "Firm", slug: "firm-a9", practiceType: "residential", region: "Bristol" });
    const [client] = await admin.insert(clients).values({ organisationId: firm, kind: "individual", displayName: "Client" }).returning();
    const [property] = await admin.insert(properties).values({ organisationId: firm, clientId: client.id, line1: "1 Admin Row", city: "Bristol", postcode: "BS8 4JX", country: "ENG", ...point, locationConfidence: "surveyor_confirmed" }).returning();
    propertyId = property.id;
    directory = await mkdtemp(path.join(tmpdir(), "surveynt-admin-"));
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  const importVersion = async (version: string, activate: boolean) => {
    const file = path.join(directory, `${version}.geojson`);
    await writeFile(file, layer(version));
    return importSpatialLayer(database.connect(database.importerUrl), { sourceKey: "historic_england_nhle", layer: "listed_building", filePath: file, datasetVersion: version, activate, importedBy: "test" });
  };

  it("audits enablement and refuses it without verification notes", async () => {
    await expect(applyDataSourceAction(operator, "historic_england_nhle", { action: "enable", notes: "too short" })).rejects.toThrow(OperationRefused);
    await applyDataSourceAction(operator, "historic_england_nhle", { action: "enable", notes: "Synthetic test layer; licence check recorded for the test." });
    const audit = await database.connect(database.adminUrl).select().from(auditEvents).where(eq(auditEvents.action, "data_source.enable"));
    expect(audit).toMatchObject([{ platformStaffId: operator.platformStaffId, resourceType: "data_source", resourceId: "historic_england_nhle" }]);
    expect((await loadDataSourceAdmin()).find((source) => source.key === "historic_england_nhle")).toMatchObject({ enabled: true, freshness: { state: "not_imported" } });
  });

  it("flags stored intelligence as out of date after a newer version is activated", async () => {
    expect((await importVersion("2026-08", true)).status).toBe("active");
    const refresh = await requestIntelligenceRefresh({ organisationId: firm, internalUserId: null }, propertyId);
    if (refresh.kind !== "queued") throw new Error(refresh.kind);
    await processIntelligenceRun(firm, refresh.run.id, { providers: [historicEnglandProvider] });
    const before = await loadPropertyIntelligence({ organisationId: firm, internalUserId: null }, propertyId);
    expect(before?.categories.find((item) => item.category === "listed_building_nhle")).toMatchObject({ status: "matched", datasetVersion: "2026-08", newerDataAvailable: false });
    const staged = await importVersion("2026-09", false);
    const activated = await activateDataSourceSync(operator, staged.syncId);
    expect(activated.activated.datasetVersion).toBe("2026-09");
    const after = await loadPropertyIntelligence({ organisationId: firm, internalUserId: null }, propertyId);
    expect(after?.categories.find((item) => item.category === "listed_building_nhle")).toMatchObject({ datasetVersion: "2026-08", newerDataAvailable: true });
    expect(await database.connect(database.adminUrl).select().from(auditEvents).where(eq(auditEvents.action, "data_source.version_activated"))).toHaveLength(1);
    await applyDataSourceAction(operator, "historic_england_nhle", { action: "rollback", layer: "listed_building" });
    const rolledBack = await loadPropertyIntelligence({ organisationId: firm, internalUserId: null }, propertyId);
    expect(rolledBack?.categories.find((item) => item.category === "listed_building_nhle")?.newerDataAvailable).toBe(false);
  });

  it("runs the daily sweep without probing disabled or policy-restricted sources", async () => {
    expect(await runDataSourceSweep()).toEqual({ probed: 0, stale: [] });
  });
});
