import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dataSources } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import type { PropertyLocation } from "../src/contract";
import { databaseHistoryQuery } from "../src/db/history";
import { getActiveSync, rollbackSource, syncSourceRegistry } from "../src/db/reference";
import { importPricePaid, importPricePaidUprnLookup } from "../src/importers/price-paid";
import { pricePaidProvider } from "../src/providers/price-paid";

// Synthetic Price Paid rows in the published 16-column layout. Ids, prices, UPRNs and addresses are invented.
const tid = (n: number) => `{8A1B2C3D-0000-4000-8000-${String(n).padStart(12, "0")}}`;
const row = (n: number, price: number, date: string, postcode: string, status = "A", type = "T") => [tid(n), String(price), `${date} 00:00`, postcode, type, "N", "F", `${n}`, "", "SYNTHETIC STREET", "", "TESTTOWN", "TEST DISTRICT", "TEST COUNTY", "A", status].map((field) => `"${field}"`).join(",");

const UPRN = "990000000101";
const NEIGHBOUR = "990000000102";
const location = (overrides: Partial<PropertyLocation> = {}): PropertyLocation => ({ propertyId: "p", country: "ENG", uprn: UPRN, latitude: 51.45, longitude: -2.6, locationConfidence: "surveyor_confirmed", postcode: "BS8 4JX", ...overrides });

async function expectDenied(work: Promise<unknown>) {
  const error = await work.then(() => null, (reason) => reason);
  expect(error, "expected the database to refuse").not.toBeNull();
  expect(String(error?.cause?.message ?? error?.message)).toMatch(/permission denied|row-level security/);
}

describe.skipIf(!integrationEnabled)("property history reference data", () => {
  let database: TestDatabase;
  let directory = "";
  let firstSync = "";

  const write = async (name: string, lines: string[]) => {
    const file = path.join(directory, name);
    await writeFile(file, `${lines.join("\n")}\n`);
    return file;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    directory = await mkdtemp(path.join(tmpdir(), "surveynt-history-"));
    const admin = database.connect(database.adminUrl);
    await syncSourceRegistry(admin);
    await admin.update(dataSources).set({ enabled: true, verifiedAt: new Date(), verifiedBy: "test", verificationNotes: "synthetic test data" }).where(eq(dataSources.key, "hmlr_ppd_uprn_lookup"));
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("imports a regional Price Paid extract without address fields", async () => {
    const importer = database.connect(database.importerUrl);
    const file = await write("pp-2026-08.csv", [row(1, 250000, "2009-05-01", "BS8 4JX"), row(2, 425000, "2019-03-12", "BS8 4JX"), row(3, 199000, "2015-01-20", "M1 1AA"), row(4, 1200000, "2021-07-01", "BS8 4JX", "A", "O")]);
    const outcome = await importPricePaid(importer, { filePath: file, datasetVersion: "2026-08", mode: "full", postcodeAreas: ["BS"], activate: true, importedBy: "test" });
    expect(outcome).toMatchObject({ status: "active", recordCount: 3, validation: { outsideExtent: 1, rejected: 0 } });
    firstSync = outcome.syncId;
    const columns = await importer.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'price_paid_transactions'`);
    expect((columns as unknown as { rows: { column_name: string }[] }).rows.map((item) => item.column_name).sort()).toEqual(["dataset_version_id", "new_build", "ppd_category", "price", "property_type", "tenure", "transaction_id", "transfer_date"]);
  });

  it("detects the look-up header and keeps multi-UPRN links", async () => {
    const importer = database.connect(database.importerUrl);
    const file = await write("lookup.csv", ["Transaction unique identifier,UPRN", `${tid(1)},${UPRN}`, `${tid(2)},${UPRN}`, `${tid(4)},${UPRN}`, `${tid(4)},${NEIGHBOUR}`, `${tid(9)},${UPRN}`, `${tid(3)},990000000103`]);
    const outcome = await importPricePaidUprnLookup(importer, { filePath: file, datasetVersion: "2026-08", activate: true, importedBy: "test" });
    expect(outcome).toMatchObject({ status: "active", recordCount: 6, validation: { header: true, multiUprnTransactions: 1 } });
  });

  it("links sales by exact UPRN only and counts links missing from Price Paid", async () => {
    const app = database.connect(database.appUrl);
    const found = await databaseHistoryQuery(app).salesForUprn(UPRN);
    expect(found).toMatchObject({ available: true, pricePaidVersion: "2026-08", publishedAt: "2026-08", postcodeAreas: ["BS"], unresolvedLinks: 1 });
    if (!found.available) throw new Error("expected data");
    expect(found.sales.map((sale) => [sale.transferDate, sale.price, sale.linkedUprnCount])).toEqual([["2021-07-01", 1200000, 2], ["2019-03-12", 425000, 1], ["2009-05-01", 250000, 1]]);
    const none = await databaseHistoryQuery(app).salesForUprn("990000000999");
    expect(none).toMatchObject({ available: true, sales: [], unresolvedLinks: 0 });
    const [result] = await pricePaidProvider.run(location(), { now: new Date(), env: {}, history: databaseHistoryQuery(app) });
    expect(result).toMatchObject({ status: "matched", coverage: "partial" });
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC STREET|TESTTOWN|BS8/);
  });

  it("applies monthly corrections and deletions to a new version, with rollback", async () => {
    const importer = database.connect(database.importerUrl);
    const file = await write("pp-monthly-2026-09.csv", [row(2, 430000, "2019-03-12", "BS8 4JX", "C"), row(1, 250000, "2009-05-01", "BS8 4JX", "D"), row(5, 610000, "2026-08-15", "BS8 4JX", "A"), row(6, 300000, "2026-08-20", "M1 1AA", "A")]);
    const outcome = await importPricePaid(importer, { filePath: file, datasetVersion: "2026-09", mode: "update", activate: true, importedBy: "test" });
    expect(outcome).toMatchObject({ status: "active", validation: { mode: "update", basedOnSyncId: firstSync, added: 1, changed: 1, deleted: 1, outsideExtent: 1 } });
    const app = database.connect(database.appUrl);
    const updated = await databaseHistoryQuery(app).salesForUprn(UPRN);
    if (!updated.available) throw new Error("expected data");
    // tid 1 deleted; tid 2 corrected; tid 5 has no look-up row yet, so it is not linked.
    expect(updated.sales.map((sale) => [sale.transferDate, sale.price])).toEqual([["2021-07-01", 1200000], ["2019-03-12", 430000]]);
    expect(updated.unresolvedLinks).toBe(2);
    await rollbackSource(importer, "hmlr_price_paid");
    const restored = await databaseHistoryQuery(app).salesForUprn(UPRN);
    if (!restored.available) throw new Error("expected data");
    expect(restored.sales.map((sale) => sale.price)).toEqual([1200000, 425000, 250000]);
  });

  it("fails a malformed import without touching the active version", async () => {
    const importer = database.connect(database.importerUrl);
    const before = await getActiveSync(importer, "hmlr_price_paid");
    const file = await write("bad.csv", [row(7, 100000, "2020-01-01", "BS1 1AA"), row(8, -1, "2020-01-01", "BS1 1AA")]);
    const failed = await importPricePaid(importer, { filePath: file, datasetVersion: "bad", mode: "full", activate: true, importedBy: "test" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/1 rows were rejected/);
    expect(failed.error).not.toMatch(/SYNTHETIC|BS1/);
    expect((await getActiveSync(importer, "hmlr_price_paid"))?.id).toBe(before?.id);
    const left = await importer.execute(sql`select count(*)::int as count from price_paid_transactions where dataset_version_id = ${failed.syncId}`);
    expect((left as unknown as { rows: { count: number }[] }).rows[0].count).toBe(0);
    await expect(importPricePaid(importer, { filePath: file, datasetVersion: "x", mode: "update", postcodeAreas: ["M"], importedBy: "test" })).rejects.toThrow(/active version's extent/);
  });

  it("refuses an unrecognised look-up header, accepts a headerless file and keeps the app read-only", async () => {
    const importer = database.connect(database.importerUrl);
    const unknown = await importPricePaidUprnLookup(importer, { filePath: await write("odd.csv", ["id,ref", "x,y"]), datasetVersion: "odd", importedBy: "test" });
    expect(unknown).toMatchObject({ status: "failed", error: expect.stringMatching(/--transaction-column/) });
    const headerless = await importPricePaidUprnLookup(importer, { filePath: await write("plain.csv", [`${tid(1)},${UPRN}`]), datasetVersion: "plain", importedBy: "test" });
    expect(headerless).toMatchObject({ status: "staging", recordCount: 1, validation: { header: false } });
    const app = database.connect(database.appUrl);
    await expectDenied(app.execute(sql`insert into price_paid_uprn_links (dataset_version_id, transaction_id, uprn) values (${headerless.syncId}, '8A1B2C3D-0000-4000-8000-000000000001', '1')`));
    // Deletes by the tenant role match no rows under the read-only policy.
    const deleted = await app.execute(sql`delete from price_paid_transactions returning transaction_id`);
    expect((deleted as unknown as { rows: unknown[] }).rows).toEqual([]);
  });

  it("reports a disabled look-up as unavailable rather than no sales", async () => {
    const admin = database.connect(database.adminUrl);
    await admin.update(dataSources).set({ enabled: false }).where(eq(dataSources.key, "hmlr_ppd_uprn_lookup"));
    const app = database.connect(database.appUrl);
    expect(await databaseHistoryQuery(app).salesForUprn(UPRN)).toEqual({ available: false, reason: "lookup_not_enabled" });
  });
});
