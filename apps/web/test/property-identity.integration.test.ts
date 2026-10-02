import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditEvents, clients, referenceDataSources, organisations, properties, propertyIdentityEvents, users } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { importOsOpenUprn, syncSourceRegistry } from "@surveynt/property-data/importers";
import { databaseRateGate, resolveCandidate, searchAddresses, updatePropertyIdentity } from "../src/lib/property-identity";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/property-data/fixtures/SYNTHETIC-TEST-ONLY-os-open-uprn.csv");
const firmA = "00000000-0000-0000-0000-0000000000a2";
const firmB = "00000000-0000-0000-0000-0000000000b2";

const postcodeResponse = { status: 200, result: { postcode: "BS8 4JX", quality: 1, latitude: 51.4544, longitude: -2.6198, country: "England", admin_district: "Bristol, City of", codes: { admin_district: "E06000023" } } };

describe.skipIf(!integrationEnabled)("property identity service", () => {
  let database: TestDatabase;
  let propertyId = "";
  let surveyorId = "";

  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_APP_URL = database.appUrl;
    process.env.PROPERTY_INTELLIGENCE_ENABLED = "true";
    const admin = database.connect(database.adminUrl);
    await syncSourceRegistry(admin);
    await admin.update(referenceDataSources).set({ enabled: true, verifiedAt: new Date(), verifiedBy: "integration-test" }).where(sql`${referenceDataSources.key} in ('postcodes_io', 'os_open_uprn')`);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a2", name: "Firm A", slug: "firm-a2", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b2", name: "Firm B", slug: "firm-b2", practiceType: "residential", region: "Leeds" },
    ]);
    const [surveyor] = await admin.insert(users).values({ clerkUserId: "user_surveyor", email: "surveyor@example.test" }).returning();
    surveyorId = surveyor.id;
    const [client] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: client.id, line1: "Flat 2, 1 Test Terrace", city: "Bristol", postcode: "BS8 4JX", country: "ENG" }).returning();
    propertyId = property.id;
    await importOsOpenUprn(database.connect(database.importerUrl), { filePath: fixture, datasetVersion: "synthetic-1", importedBy: "test", activate: true });
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await database?.drop();
    await stopRelay();
  });

  it("searches a postcode once, caches the public response and keeps the lookup tenant-scoped", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(postcodeResponse), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await searchAddresses({ organisationId: firmA, internalUserId: surveyorId, demo: false }, "bs8 4jx");
    expect(first).toMatchObject({ status: "matched", demo: false });
    expect(first.candidates[0]).toMatchObject({ confidence: "postcode_centroid", precision: "postcode" });
    await new Promise((resolve) => setTimeout(resolve, 450));
    const second = await searchAddresses({ organisationId: firmA, internalUserId: surveyorId, demo: false }, "BS8 4JX");
    expect(second.lookupId).toBe(first.lookupId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const foreign = await resolveCandidate({ organisationId: firmB, internalUserId: null, demo: false }, first.lookupId!, 0);
    expect(foreign).toMatchObject({ problem: "not_found" });
  });

  it("resolves a postcode centroid to UPRN candidates without selecting one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
    await new Promise((resolve) => setTimeout(resolve, 450));
    const search = await searchAddresses({ organisationId: firmA, internalUserId: surveyorId, demo: false }, "BS8 4JX");
    const resolved = await resolveCandidate({ organisationId: firmA, internalUserId: surveyorId, demo: false }, search.lookupId!, 0);
    if ("problem" in resolved) throw new Error(resolved.message);
    expect(resolved.uprn.autoSelectable).toBe(false);
    expect(resolved.uprn.searchRadiusMetres).toBe(250);
    expect(resolved.uprn.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["origin_is_postcode_centroid", "multiple_at_same_point"]));
    expect(resolved.uprn.candidates.length).toBeGreaterThanOrEqual(5);
  });

  it("sets an approximate location, then confirms a UPRN only with evidence and records the history", async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const search = await searchAddresses({ organisationId: firmA, internalUserId: surveyorId, demo: false }, "BS8 4JX");
    const context = { organisationId: firmA, internalUserId: surveyorId, demo: false };
    const located = await updatePropertyIdentity(context, propertyId, { action: "set_location", version: 1, lookupId: search.lookupId!, index: 0 });
    expect(located).toMatchObject({ kind: "updated", property: { locationConfidence: "postcode_centroid", uprn: null, version: 2 } });
    expect(await updatePropertyIdentity(context, propertyId, { action: "confirm_uprn", version: 2, uprn: "990000000002", evidenceType: "other", note: "" })).toMatchObject({ kind: "invalid" });
    expect(await updatePropertyIdentity(context, propertyId, { action: "confirm_uprn", version: 1, uprn: "990000000002", evidenceType: "title_documents" })).toEqual({ kind: "conflict" });
    const confirmed = await updatePropertyIdentity(context, propertyId, { action: "confirm_uprn", version: 2, uprn: "990000000002", evidenceType: "title_documents", note: "Flat 2 on the title plan", fromCandidates: true });
    expect(confirmed).toMatchObject({ kind: "updated", property: { uprn: "990000000002", locationConfidence: "surveyor_confirmed", locationResolutionMethod: "uprn_candidate_confirmed", confirmedByUserId: surveyorId, version: 3 } });
    const protectedLocation = await updatePropertyIdentity(context, propertyId, { action: "set_location", version: 3, lookupId: search.lookupId!, index: 0 });
    expect(protectedLocation).toMatchObject({ kind: "invalid" });
    const admin = database.connect(database.adminUrl);
    const history = await admin.select().from(propertyIdentityEvents).where(eq(propertyIdentityEvents.propertyId, propertyId));
    expect(history.map((event) => event.action).sort()).toEqual(["confirm_uprn", "set_location"]);
    expect(history.find((event) => event.action === "confirm_uprn")?.evidence).toMatchObject({ evidenceType: "title_documents", referenceCheck: "found_in_active_release", fromCandidates: true });
    const audit = await admin.select().from(auditEvents).where(eq(auditEvents.resourceId, propertyId));
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(["property.identity.set_location", "property.identity.confirm_uprn"]));
  });

  it("cannot change another firm's property, even with its id", async () => {
    const result = await updatePropertyIdentity({ organisationId: firmB, internalUserId: null, demo: false }, propertyId, { action: "set_country", version: 3, country: "WLS" });
    expect(result).toEqual({ kind: "missing" });
  });

  it("spaces provider requests across callers", async () => {
    const gate = databaseRateGate(database.connect(database.appUrl));
    expect(await gate.acquire("test-provider", 5000, 0)).toBe(true);
    expect(await gate.acquire("test-provider", 5000, 0)).toBe(false);
    const started = Date.now();
    expect(await gate.acquire("spaced-provider", 300, 1000)).toBe(true);
    expect(await gate.acquire("spaced-provider", 300, 1000)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });
});
