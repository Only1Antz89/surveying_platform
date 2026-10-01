import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectImport, parseArguments, splitCsv } from "../scripts/import-property-data";

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
});
