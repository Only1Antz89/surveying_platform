import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { geometryToWkt, parsePrepareArguments, prepareGeoJson } from "../scripts/prepare-spatial-geojson";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("spatial GeoJSON preparation", () => {
  it("converts supported GeoJSON polygon geometry to WKT", () => {
    expect(geometryToWkt({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toBe("POLYGON((0 0,1 0,1 1,0 0))");
    expect(geometryToWkt({ type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [0, 0]]]] })).toBe("MULTIPOLYGON(((0 0,1 0,0 0)))");
  });

  it("accepts repeated, uniquely labelled inputs and rejects an unsupported CRS", () => {
    expect(parsePrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--input", "listed=/tmp/listed.geojson", "--input", "scheduled=/tmp/scheduled.geojson"]).inputs).toHaveLength(2);
    expect(() => parsePrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:27700", "--input", "listed=/tmp/listed.geojson"])).toThrow(/source-crs/);
    expect(() => parsePrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--input", "listed=/tmp/a.geojson", "--input", "listed=/tmp/b.geojson"])).toThrow(/unique/);
  });

  it("writes import-ready CSV with stable prefixed identifiers and provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-geojson-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "input.geojson");
    const output = join(directory, "output.csv");
    await writeFile(input, JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { ListEntry: "123", Name: "Example, Hall" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] } }] }));
    const result = await prepareGeoJson({ output, sourceCrs: "EPSG:4326", inputs: [{ label: "listed_building", path: input }] });
    const prepared = await readFile(output, "utf8");
    expect(result.records).toBe(1);
    expect(prepared).toContain("listed_building:123");
    expect(prepared).toContain('"Example, Hall"');
    expect(prepared).toContain('designationType');
    await expect(prepareGeoJson({ output, sourceCrs: "EPSG:4326", inputs: [{ label: "listed_building", path: input }] })).rejects.toThrow(/already exists/);
  });
});
