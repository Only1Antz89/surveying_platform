import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { geometryToWkt, parsePrepareArguments, prepareGeoJson, streamGeoJsonFeatures } from "../scripts/prepare-spatial-geojson";

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
    const parsed = parsePrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--input", "listed=/tmp/listed.geojson", "--input", "scheduled=/tmp/scheduled.geojson", "--where", "Flood_zone=2"]);
    expect(parsed.inputs).toHaveLength(2);
    expect(parsed.where).toEqual({ field: "Flood_zone", value: "2" });
    expect(() => parsePrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:27700", "--input", "listed=/tmp/listed.geojson"])).toThrow(/source-crs/);
    expect(() => parsePrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--input", "listed=/tmp/a.geojson", "--input", "listed=/tmp/b.geojson"])).toThrow(/unique/);
  });

  it("streams features across chunk boundaries without loading the collection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-geojson-stream-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "stream.geojson");
    const largeName = `Name ${"x".repeat(70_000)}`;
    await writeFile(input, JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { OBJECTID: 1, Name: largeName }, geometry: { type: "Point", coordinates: [-2.6, 51.4] } }, { type: "Feature", properties: { OBJECTID: 2 }, geometry: { type: "Point", coordinates: [-2.7, 51.5] } }] }));
    const ids: unknown[] = [];
    await streamGeoJsonFeatures(input, "EPSG:4326", async (feature) => { ids.push(feature.properties?.OBJECTID); });
    expect(ids).toEqual([1, 2]);
  });

  it("filters a source property case-insensitively for separate flood-zone outputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-geojson-filter-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "flood.geojson");
    const output = join(directory, "zone-2.csv");
    await writeFile(input, JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { OBJECTID: 1, FLOOD_ZONE: 2 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] } }, { type: "Feature", properties: { OBJECTID: 2, FLOOD_ZONE: 3 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [0, 0]]] } }] }));
    const result = await prepareGeoJson({ output, sourceCrs: "EPSG:4326", inputs: [{ label: "flood_zone_2", path: input }], where: { field: "flood_zone", value: "2" } });
    expect(result.records).toBe(1);
    const prepared = await readFile(output, "utf8");
    expect(prepared).toContain("flood_zone_2:1");
    expect(prepared).not.toContain("flood_zone_2:2");
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

  it("keeps multipart authoritative records unique using their stable feature identifier", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-geojson-multipart-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "input.geojson");
    const output = join(directory, "output.csv");
    await writeFile(input, JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", properties: { ListEntry: "1495772", OBJECTID: 207 }, geometry: { type: "Point", coordinates: [-0.75, 52.04] } },
      { type: "Feature", properties: { ListEntry: "1495772", OBJECTID: 208 }, geometry: { type: "Point", coordinates: [-0.76, 52.04] } },
    ] }));
    await prepareGeoJson({ output, sourceCrs: "EPSG:4326", inputs: [{ label: "certificate_of_immunity", path: input }] });
    const prepared = await readFile(output, "utf8");
    expect(prepared).toContain("certificate_of_immunity:1495772:207");
    expect(prepared).toContain("certificate_of_immunity:1495772:208");
  });
});
