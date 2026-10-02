import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { clients, referenceDataSources, referenceDatasetSyncs, organisations, properties, propertyIdentityEvents } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { activateSync, findUprnCandidates, getActiveSync, getSourceState, rollbackSource, syncSourceRegistry, uprnExists } from "../src/db/reference";
import { importOsOpenUprn } from "../src/importers/os-open-uprn";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/SYNTHETIC-TEST-ONLY-os-open-uprn.csv");
const flatsPoint = { latitude: 51.4544, longitude: -2.6198 };

async function expectDenied(work: Promise<unknown>, pattern = /permission denied|row-level security|violates/) {
  const error = await work.then(() => null, (reason) => reason);
  expect(error, "expected the database to refuse").not.toBeNull();
  expect(String(error?.cause?.message ?? error?.message)).toMatch(pattern);
}

describe.skipIf(!integrationEnabled)("reference data and property identity", () => {
  let database: TestDatabase;
  let firstSync = "";
  const firmA = "00000000-0000-0000-0000-0000000000a1";
  const firmB = "00000000-0000-0000-0000-0000000000b1";
  let propertyA = "";

  beforeAll(async () => {
    database = await createTestDatabase();
    const admin = database.connect(database.adminUrl);
    await syncSourceRegistry(admin);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a1", name: "Firm A", slug: "firm-a1", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b1", name: "Firm B", slug: "firm-b1", practiceType: "residential", region: "Leeds" },
    ]);
    const [client] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: client.id, line1: "Flat 2, 1 Test Terrace", city: "Bristol", postcode: "BS8 4JX" }).returning();
    propertyA = property.id;
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("registers every source disabled by default", async () => {
    const app = database.connect(database.appUrl);
    expect(await getSourceState(app, "os_open_uprn")).toEqual({ enabled: false, registered: true });
    const blocked = await app.select().from(referenceDataSources).where(eq(referenceDataSources.key, "bgs_geology_50k"));
    expect(blocked[0].enabled).toBe(false);
  });

  it("imports the labelled synthetic fixture as a staged version, then activates it atomically", async () => {
    const importer = database.connect(database.importerUrl);
    const outcome = await importOsOpenUprn(importer, { filePath: fixture, datasetVersion: "synthetic-1", importedBy: "test" });
    expect(outcome).toMatchObject({ status: "staging", recordCount: 7, skipped: 1 });
    expect(outcome.validation).toMatchObject({ crsDiscrepant: 0 });
    const app = database.connect(database.appUrl);
    expect((await findUprnCandidates(app, { ...flatsPoint, radiusMetres: 30 })).referenceAvailable).toBe(false);
    await activateSync(importer, outcome.syncId);
    firstSync = outcome.syncId;
    expect((await getActiveSync(app, "os_open_uprn"))?.id).toBe(outcome.syncId);
  });

  it("returns metre-accurate candidates and keeps co-located flats together", async () => {
    const app = database.connect(database.appUrl);
    const near = await findUprnCandidates(app, { ...flatsPoint, radiusMetres: 30 });
    expect(near.candidates.map((candidate) => candidate.uprn)).toEqual(["990000000001", "990000000002", "990000000003", "990000000004"]);
    expect(near.candidates[0].distanceMetres).toBeLessThan(0.5);
    expect(near.candidates[3].distanceMetres).toBeGreaterThan(18);
    expect(near.candidates[3].distanceMetres).toBeLessThan(22);
    const wider = await findUprnCandidates(app, { ...flatsPoint, radiusMetres: 75 });
    expect(wider.candidates.map((candidate) => candidate.uprn)).toContain("990000000005");
    expect(wider.candidates.map((candidate) => candidate.uprn)).not.toContain("990000000006");
    const centroid = await findUprnCandidates(app, { ...flatsPoint, radiusMetres: 250 });
    expect(centroid.candidates.map((candidate) => candidate.uprn)).toContain("990000000006");
    expect(centroid.candidates.map((candidate) => candidate.uprn)).not.toContain("990000000007");
    expect((await uprnExists(app, "990000000004")).exists).toBe(true);
    expect((await uprnExists(app, "990000000099")).exists).toBe(false);
  });

  it("keeps the tenant runtime read-only on reference data", async () => {
    const app = database.connect(database.appUrl);
    await expectDenied(app.execute(sql`insert into reference.os_open_uprn (dataset_sync_id, uprn, geom) values (${firstSync}, '1', st_setsrid(st_makepoint(-2, 51), 4326))`));
    await expectDenied(app.update(referenceDataSources).set({ enabled: true }).where(eq(referenceDataSources.key, "os_open_uprn")));
    await expectDenied(app.update(referenceDatasetSyncs).set({ status: "retired" }).where(eq(referenceDatasetSyncs.id, firstSync)));
  });

  it("keeps the importer away from tenant records", async () => {
    const importer = database.connect(database.importerUrl);
    await expectDenied(importer.select().from(properties));
    await expectDenied(importer.update(referenceDataSources).set({ enabled: true }).where(eq(referenceDataSources.key, "os_open_uprn")));
  });

  it("leaves the active version untouched when an import fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "surveynt-import-"));
    const bad = path.join(directory, "bad.csv");
    await writeFile(bad, "UPRN,EASTING,NORTHING\n1,2,3\n");
    const importer = database.connect(database.importerUrl);
    const outcome = await importOsOpenUprn(importer, { filePath: bad, datasetVersion: "broken", importedBy: "test", activate: true });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/Unexpected header/);
    expect((await getActiveSync(importer, "os_open_uprn"))?.id).toBe(firstSync);
    await expect(activateSync(importer, outcome.syncId)).rejects.toThrow(/completed, validated/);
  });

  it("supports activation of a newer version and rollback to the previous one", async () => {
    const importer = database.connect(database.importerUrl);
    const second = await importOsOpenUprn(importer, { filePath: fixture, datasetVersion: "synthetic-2", importedBy: "test", activate: true, bbox: { minLongitude: -3, minLatitude: 51, maxLongitude: -2, maxLatitude: 52 } });
    expect(second).toMatchObject({ status: "active", recordCount: 6 });
    const app = database.connect(database.appUrl);
    expect((await findUprnCandidates(app, { latitude: 53.7996, longitude: -1.5491, radiusMetres: 10 })).candidates).toHaveLength(0);
    const restored = await rollbackSource(importer, "os_open_uprn");
    expect(restored.id).toBe(firstSync);
    expect((await findUprnCandidates(app, { latitude: 53.7996, longitude: -1.5491, radiusMetres: 10 })).candidates).toHaveLength(1);
    const active = await importer.select().from(referenceDatasetSyncs).where(eq(referenceDatasetSyncs.status, "active"));
    expect(active).toHaveLength(1);
  });

  // The coordinate and UPRN checks now come from the England release's migration 0006.
  // UK bounds, confidence-versus-point and UPRN-confirmation rules are enforced by the
  // identity service rather than the database, because the England release writes
  // these columns under its own rules.
  it("enforces coordinate pairing, ranges and UPRN format on properties, and keeps the point in step", async () => {
    const app = database.connect(database.appUrl);
    const update = (values: Partial<typeof properties.$inferInsert>) => app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${firmA}, true)`);
      return tx.update(properties).set(values).where(eq(properties.id, propertyA)).returning();
    });
    await expectDenied(update({ latitude: 51.45 }), /properties_coordinates_pair_check/);
    await expectDenied(update({ latitude: 95, longitude: 2.35 }), /properties_latitude_check/);
    await expectDenied(update({ uprn: "12-34", uprnConfirmedAt: new Date(), uprnEvidenceType: "site_inspection" }), /properties_uprn_check/);
    const [resolved] = await update({ latitude: 51.4544, longitude: -2.6198, locationConfidence: "postcode_centroid", uprn: "990000000002", uprnConfirmedAt: new Date(), uprnEvidenceType: "title_documents" });
    expect(resolved.location).toEqual({ x: -2.6198, y: 51.4544 });
  });

  it("keeps identity events immutable and tenant-scoped", async () => {
    const app = database.connect(database.appUrl);
    const [event] = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${firmA}, true)`);
      return tx.insert(propertyIdentityEvents).values({ organisationId: firmA, propertyId: propertyA, action: "uprn_confirmed", evidence: { evidenceType: "title_documents" } }).returning();
    });
    await expectDenied(app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${firmA}, true)`);
      await tx.update(propertyIdentityEvents).set({ action: "edited" }).where(eq(propertyIdentityEvents.id, event.id));
    }), /immutable/);
    const visibleToB = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${firmB}, true)`);
      return tx.select().from(propertyIdentityEvents);
    });
    expect(visibleToB).toHaveLength(0);
    await expectDenied(app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${firmB}, true)`);
      await tx.insert(propertyIdentityEvents).values({ organisationId: firmB, propertyId: propertyA, action: "forged" });
    }));
  });
});
