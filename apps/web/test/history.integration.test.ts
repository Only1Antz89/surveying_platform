import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { clients, dataSources, jobs, jobStageEvents, organisations, properties } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { pricePaidProvider } from "@surveynt/property-data";
import { importPricePaid, importPricePaidUprnLookup, syncSourceRegistry } from "@surveynt/property-data/importers";
import { processIntelligenceRun, requestIntelligenceRefresh } from "../src/lib/intelligence";
import { loadPropertyHistory } from "../src/lib/property-history";

const firmA = "00000000-0000-0000-0000-0000000000a6";
const firmB = "00000000-0000-0000-0000-0000000000b6";
const UPRN = "990000000201";

// Synthetic Price Paid rows (16-column layout) and look-up links; ids, prices, UPRNs and addresses are invented.
const tid = (n: number) => `{8A1B2C3D-0000-4000-8000-${String(n).padStart(12, "0")}}`;
const row = (n: number, price: number, date: string) => [tid(n), String(price), `${date} 00:00`, "BS8 4JX", "T", "N", "F", `${n}`, "", "SYNTHETIC STREET", "", "TESTTOWN", "TEST DISTRICT", "TEST COUNTY", "A", "A"].map((field) => `"${field}"`).join(",");

describe.skipIf(!integrationEnabled)("property history timeline", () => {
  let database: TestDatabase;
  let propertyId = "";
  let unconfirmedId = "";
  const context = { organisationId: firmA, internalUserId: null };

  async function enrich(id: string) {
    const refresh = await requestIntelligenceRefresh(context, id);
    if (refresh.kind !== "queued") throw new Error(`expected a queued run, got ${refresh.kind}`);
    await processIntelligenceRun(firmA, refresh.run.id, { providers: [pricePaidProvider] });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, PROPERTY_INTELLIGENCE_ENABLED: "true" });
    const admin = database.connect(database.adminUrl);
    await syncSourceRegistry(admin);
    await admin.update(dataSources).set({ enabled: true, verifiedAt: new Date(), verifiedBy: "integration-test" }).where(sql`${dataSources.key} in ('hmlr_price_paid', 'hmlr_ppd_uprn_lookup')`);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a6", name: "Firm A", slug: "firm-a6", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b6", name: "Firm B", slug: "firm-b6", practiceType: "residential", region: "Leeds" },
    ]);
    const [clientA] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [clientB] = await admin.insert(clients).values({ organisationId: firmB, kind: "individual", displayName: "Client B" }).returning();
    const identity = { country: "ENG" as const, latitude: 51.4544, longitude: -2.6198, locationConfidence: "surveyor_confirmed" as const };
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: clientA.id, line1: "1 Test Crescent", city: "Bristol", postcode: "BS8 4JX", ...identity, uprn: UPRN, uprnConfirmedAt: new Date(), uprnEvidenceType: "site_inspection" }).returning();
    const [unconfirmed] = await admin.insert(properties).values({ organisationId: firmA, clientId: clientA.id, line1: "2 Test Crescent", city: "Bristol", postcode: "BS8 4JX", ...identity }).returning();
    // Another firm has a job at the same UPRN; its events must never appear for firm A.
    const [otherProperty] = await admin.insert(properties).values({ organisationId: firmB, clientId: clientB.id, line1: "1 Test Crescent", city: "Bristol", postcode: "BS8 4JX", ...identity, uprn: UPRN, uprnConfirmedAt: new Date(), uprnEvidenceType: "site_inspection" }).returning();
    propertyId = property.id;
    unconfirmedId = unconfirmed.id;
    const [jobA] = await admin.insert(jobs).values({ organisationId: firmA, clientId: clientA.id, propertyId, reference: "J-A1", serviceName: "Level 2 survey", stage: "scheduled" }).returning();
    const [jobB] = await admin.insert(jobs).values({ organisationId: firmB, clientId: clientB.id, propertyId: otherProperty.id, reference: "J-B1", serviceName: "Level 3 survey", stage: "issued" }).returning();
    await admin.insert(jobStageEvents).values([
      { organisationId: firmA, jobId: jobA.id, fromStage: "instructed", toStage: "scheduled", createdAt: new Date("2026-09-20T09:00:00Z") },
      { organisationId: firmB, jobId: jobB.id, fromStage: "internal_review", toStage: "issued", createdAt: new Date("2026-09-21T09:00:00Z") },
    ]);
    const directory = await mkdtemp(path.join(tmpdir(), "surveynt-history-web-"));
    const ppd = path.join(directory, "pp.csv");
    await writeFile(ppd, [row(1, 182500, "2004-07-30"), row(2, 425000, "2019-03-12"), row(3, 999999, "2020-01-01")].join("\n"));
    const lookup = path.join(directory, "lookup.csv");
    await writeFile(lookup, ["Transaction unique identifier,UPRN", `${tid(1)},${UPRN}`, `${tid(2)},${UPRN}`, `${tid(3)},990000000299`].join("\n"));
    const importer = database.connect(database.importerUrl);
    expect(await importPricePaid(importer, { filePath: ppd, datasetVersion: "2026-09", mode: "full", activate: true, importedBy: "test" })).toMatchObject({ status: "active" });
    expect(await importPricePaidUprnLookup(importer, { filePath: lookup, datasetVersion: "2026-09", activate: true, importedBy: "test" })).toMatchObject({ status: "active" });
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("merges linked sales and firm events with separate event, publication and retrieval dates", async () => {
    await enrich(propertyId);
    const history = await loadPropertyHistory(context, propertyId);
    if (!history) throw new Error("expected history");
    expect(history.events.map((event) => [event.kind, event.eventDate?.slice(0, 10)])).toEqual([["job_stage", "2026-09-20"], ["sale", "2019-03-12"], ["sale", "2004-07-30"]]);
    const sale = history.events.find((event) => event.kind === "sale")!;
    expect(sale).toMatchObject({ title: "Sold for £425,000", origin: "external", sourceKey: "hmlr_price_paid", informationClass: "authoritative_external", publishedDate: "2026-09", stale: false });
    expect(sale.retrievedAt?.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect(history.coverage[0]).toMatchObject({ label: "Sales (HM Land Registry Price Paid)", status: "matched" });
    expect(JSON.stringify(history)).not.toMatch(/SYNTHETIC STREET|999999|J-B1/);
  });

  it("explains why sales were not checked without a confirmed UPRN", async () => {
    await enrich(unconfirmedId);
    const history = await loadPropertyHistory(context, unconfirmedId);
    expect(history?.events).toEqual([]);
    expect(history?.coverage[0]).toMatchObject({ status: "unsupported", message: expect.stringMatching(/confirmed UPRN/) });
  });

  it("marks sales stale after the identity changes, and hides the timeline from other firms", async () => {
    const admin = database.connect(database.adminUrl);
    await admin.update(properties).set({ latitude: 51.4546 }).where(sql`${properties.id} = ${propertyId}`);
    const history = await loadPropertyHistory(context, propertyId);
    expect(history?.events.filter((event) => event.kind === "sale").every((event) => event.stale)).toBe(true);
    expect(await loadPropertyHistory({ organisationId: firmB, internalUserId: null }, propertyId)).toBeNull();
  });
});
