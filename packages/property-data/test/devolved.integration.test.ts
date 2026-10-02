import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import type { PropertyLocation } from "../src/contract";
import { syncSourceRegistry } from "../src/db/reference";
import { databaseScottishEpcQuery } from "../src/db/scottish-epc";
import { databaseSpatialQuery } from "../src/db/spatial";
import { importScottishEpc } from "../src/importers/scottish-epc";
import { importSpatialLayer } from "../src/importers/spatial-layer";
import { floodZonesProvider, nrwFloodZonesProvider } from "../src/providers/reference-layer";
import { scottishEpcProvider } from "../src/providers/scottish-epc";

// Synthetic layers and certificates only. The square sits near Cardiff, the certificates at an invented UPRN.
const square = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { fid: "z3", flood_zone: "3" }, geometry: { type: "Polygon", coordinates: [[[-3.19, 51.47], [-3.17, 51.47], [-3.17, 51.49], [-3.19, 51.49], [-3.19, 51.47]]] } }] });
const location = (country: PropertyLocation["country"], overrides: Partial<PropertyLocation> = {}): PropertyLocation => ({ propertyId: "p", country, uprn: "990000000301", latitude: 51.48, longitude: -3.18, locationConfidence: "surveyor_confirmed", postcode: null, ...overrides });

describe.skipIf(!integrationEnabled)("country-specific sources", () => {
  let database: TestDatabase;
  let directory = "";
  const write = async (name: string, content: string) => { const file = path.join(directory, name); await writeFile(file, content); return file; };

  beforeAll(async () => {
    database = await createTestDatabase();
    directory = await mkdtemp(path.join(tmpdir(), "surveynt-devolved-"));
    await syncSourceRegistry(database.connect(database.adminUrl));
    const importer = database.connect(database.importerUrl);
    for (const [sourceKey, version] of [["nrw_flood_map_planning", "nrw-synthetic"], ["ea_flood_zones", "ea-synthetic"]] as const) {
      const outcome = await importSpatialLayer(importer, { sourceKey, layer: "flood_zone_3", filePath: await write(`${sourceKey}.geojson`, square), datasetVersion: version, activate: true, importedBy: "test" });
      expect(outcome.status).toBe("active");
    }
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("answers for Wales only from Natural Resources Wales, never from the Environment Agency", async () => {
    const context = { now: new Date(), env: {}, spatial: databaseSpatialQuery(database.connect(database.appUrl)) };
    expect(floodZonesProvider.applicability(location("WLS"), context)).toMatchObject({ ok: false, status: "unsupported", coverage: "not_covered" });
    expect(nrwFloodZonesProvider.applicability(location("ENG"), context)).toMatchObject({ ok: false, status: "unsupported", coverage: "not_covered" });
    const results = await nrwFloodZonesProvider.run(location("WLS"), context);
    expect(results.map((item) => [item.category, item.status, item.datasetVersion])).toEqual([["wales_flood_zone_3", "matched", "nrw-synthetic"], ["wales_flood_zone_2", "not_configured", null]]);
  });

  it("imports Scottish EPC certificates by UPRN without address fields and serves Scottish properties only", async () => {
    const importer = database.connect(database.importerUrl);
    const header = "OSG_REFERENCE_NUMBER,REPORT_REFERENCE_NUMBER,LODGEMENT_DATE,CURRENT_ENERGY_RATING,POTENTIAL_ENERGY_RATING,PROPERTY_TYPE,BUILT_FORM,CONSTRUCTION_AGE_BAND,TOTAL_FLOOR_AREA,ADDRESS1,POSTCODE";
    const file = await write("sepc.csv", [header,
      "990000000301,0100-0001-0001,2018-03-01,E,C,House,Semi-Detached,1950-1964,92.5,\"1 SYNTHETIC ROAD\",EH1 1AA",
      "990000000301,0100-0001-0002,2024-06-15,D,B,House,Semi-Detached,1950-1964,92.5,\"1 SYNTHETIC ROAD\",EH1 1AA",
      ",0100-0001-0003,2024-06-15,C,B,Flat,,,55,\"FLAT 2 SYNTHETIC ROAD\",EH1 1AA",
      "990000000302,0100-0001-0004,31/02/2020,Z,B,Flat,,,61,\"FLAT 3 SYNTHETIC ROAD\",EH1 1AA",
    ].join("\n"));
    const outcome = await importScottishEpc(importer, { filePath: file, datasetVersion: "2026-Q3", activate: true, importedBy: "test" });
    expect(outcome).toMatchObject({ status: "active", recordCount: 3, validation: { withoutUprn: 1, rejected: 0 } });
    const columns = await importer.execute(sql`select column_name from information_schema.columns where table_schema = 'reference' and table_name = 'scottish_epc_certificates'`);
    expect((columns as unknown as { rows: { column_name: string }[] }).rows.map((row) => row.column_name)).not.toEqual(expect.arrayContaining(["address1", "postcode"]));
    const invalid = await importer.execute(sql`select lodgement_date, current_rating from scottish_epc_certificates where certificate_key = '0100-0001-0004'`);
    expect((invalid as unknown as { rows: unknown[] }).rows[0]).toEqual({ lodgement_date: null, current_rating: null });

    const context = { now: new Date(), env: {}, scottishEpc: databaseScottishEpcQuery(database.connect(database.appUrl)) };
    expect(scottishEpcProvider.applicability(location("ENG"), context)).toMatchObject({ ok: false, coverage: "not_covered" });
    expect(scottishEpcProvider.applicability(location("SCT", { uprn: null }), context)).toMatchObject({ ok: false, message: expect.stringMatching(/confirmed UPRN/) });
    const [result] = await scottishEpcProvider.run(location("SCT"), context);
    expect(result).toMatchObject({ status: "matched", category: "energy_certificate_scotland", datasetVersion: "2026-Q3" });
    expect(result.records.map((record) => [record.sourceRecordId, record.data.currentRating, record.data.latest])).toEqual([["0100-0001-0002", "D", true], ["0100-0001-0001", "E", false]]);
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC ROAD|EH1/);
    const [none] = await scottishEpcProvider.run(location("SCT", { uprn: "990000000399" }), context);
    expect(none).toMatchObject({ status: "no_match", coverage: "partial" });
  });

  it("refuses an extract without a UPRN column unless one is named", async () => {
    const importer = database.connect(database.importerUrl);
    const file = await write("odd.csv", ["REF_NO,UPRN_OS,DATE", "0200-1,990000000310,2025-01-01"].join("\n"));
    expect(await importScottishEpc(importer, { filePath: file, datasetVersion: "odd", importedBy: "test" })).toMatchObject({ status: "failed", error: expect.stringMatching(/--column uprn=/) });
    expect(await importScottishEpc(importer, { filePath: file, datasetVersion: "odd-mapped", columns: { uprn: "UPRN_OS", certificateKey: "REF_NO", lodgementDate: "DATE" }, importedBy: "test" })).toMatchObject({ status: "staging", recordCount: 1 });
  });
});
