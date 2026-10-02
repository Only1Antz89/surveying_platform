import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertImportReady, inspectImport, parseArguments, splitCsv } from "../scripts/import-property-data";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("property reference-data import gates", () => {
  it("parses quoted CSV fields without corrupting embedded commas or quotes", () => {
    expect(splitCsv('123,"Listed building, Grade II","A ""quoted"" value"')).toEqual(["123", "Listed building, Grade II", 'A "quoted" value']);
  });

  it("requires an explicit supported CRS and HTTPS provenance URL", () => {
    const base = ["--source", "historic_england", "--version", "2026-10", "--file", "/tmp/data.csv", "--source-url", "https://example.test/data.csv"];
    expect(() => parseArguments(base)).toThrow(/source-crs/);
    expect(() => parseArguments([...base, "--source-crs", "EPSG:3857"])).toThrow(/source-crs/);
    expect(() => parseArguments(["--source", "historic_england", "--version", "2026-10", "--file", "/tmp/data.csv", "--source-url", "http://example.test/data.csv", "--source-crs", "EPSG:4326"])).toThrow(/HTTPS/);
  });

  it("keeps staging and activation as separate commands", () => {
    expect(() => parseArguments(["--source", "historic_england", "--version", "2026-10", "--file", "/tmp/data.csv", "--source-url", "https://example.test/data.csv", "--source-crs", "EPSG:4326", "--activate", "true"])).toThrow(/separate gates/);
  });

  it("requires checksum, licence confirmation and projected Neon cost before staging", () => {
    const base = parseArguments(["--source", "historic_england", "--version", "2026-10", "--file", "/tmp/data.csv", "--source-url", "https://example.test/data.csv", "--source-crs", "EPSG:4326"]);
    expect(() => assertImportReady(base)).toThrow(/checksum/);
    expect(() => assertImportReady({ ...base, expectedChecksum: "a".repeat(64) })).toThrow(/licence-confirmed/);
    expect(() => assertImportReady({ ...base, expectedChecksum: "a".repeat(64), licenceConfirmed: true })).toThrow(/Neon cost/);
    expect(() => assertImportReady({ ...base, expectedChecksum: "a".repeat(64), licenceConfirmed: true, neonStorageUsdPerGbMonth: 0.2 })).not.toThrow();
    expect(() => assertImportReady({ ...base, dryRun: true })).not.toThrow();
  });

  it("reports records, malformed rows, missing fields and projected storage cost", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-property-import-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "heritage.csv");
    await writeFile(path, "source_record_id,wkt,name\nHE-1,POINT(-2.62 51.46),Example\n", "utf8");
    const report = await inspectImport(path, "historic_england", "EPSG:4326", 0.2);
    expect(report.recordCount).toBe(1);
    expect(report.invalidRows).toBe(0);
    expect(report.missingColumns).toEqual([]);
    expect(report.sourceCrs).toBe("EPSG:4326");
    expect(report.projectedStorageUsdPerMonth).not.toBeNull();
  });

  it("rejects invalid UPRNs and coordinate ranges during preflight", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-property-import-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "uprn.csv");
    await writeFile(path, "uprn,latitude,longitude\ninvalid,,-181\n", "utf8");
    const report = await inspectImport(path, "os_open_uprn", "EPSG:4326", 0.2);
    expect(report.invalidRows).toBe(1);
    expect(report.validationErrors[0]?.reasons).toEqual(expect.arrayContaining(["uprn must contain 1-12 digits", "latitude is outside -90 to 90", "longitude is outside -180 to 180"]));
  });

  it("reports duplicate headers and malformed spatial metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-property-import-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "spatial.csv");
    await writeFile(path, "\uFEFFsource_record_id,wkt,wkt,properties_json\n,not-wkt,also-not-wkt,[]\n", "utf8");
    const report = await inspectImport(path, "historic_england", "EPSG:4326", 0.2);
    expect(report.duplicateHeaders).toEqual(["wkt"]);
    expect(report.invalidRows).toBe(1);
    expect(report.validationErrors[0]?.reasons).toEqual(expect.arrayContaining(["source_record_id is empty", "wkt is not a supported geometry", "properties_json must be a JSON object"]));
  });

  it("treats a header-only file as an empty import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-property-import-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "empty.csv");
    await writeFile(path, "source_record_id,wkt\n", "utf8");
    const report = await inspectImport(path, "historic_england", "EPSG:4326", 0.2);
    expect(report.recordCount).toBe(0);
  });
});
