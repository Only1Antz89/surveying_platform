import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gmlMemberToRecord, parseGmlPrepareArguments, prepareGml } from "../scripts/prepare-spatial-gml";

const temporaryDirectories: string[] = [];
const parcel = (id = "123") => `<wfs:member><LR:PREDEFINED><LR:GEOMETRY><gml:Polygon srsName="urn:ogc:def:crs:EPSG::27700"><gml:exterior><gml:LinearRing><gml:posList>0 0 10 0 10 10 0 0</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></LR:GEOMETRY><LR:INSPIREID>${id}</LR:INSPIREID><LR:LABEL>${id}</LR:LABEL><LR:NATIONALCADASTRALREFERENCE>${id}</LR:NATIONALCADASTRALREFERENCE><LR:VALIDFROM>2026-01-01</LR:VALIDFROM></LR:PREDEFINED></wfs:member>`;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("HMLR INSPIRE GML preparation", () => {
  it("converts a BNG parcel to import-ready WKT and an explicit indicative caveat", () => {
    const record = gmlMemberToRecord(parcel(), "example_authority");
    expect(record.sourceRecordId).toBe("inspire:123");
    expect(record.wkt).toBe("POLYGON((0 0,10 0,10 10,0 0))");
    expect(record.properties.boundaryStatus).toBe("indicative_non_definitive");
  });

  it("requires BNG input and unique authority labels", () => {
    expect(() => parseGmlPrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--input", "a=/tmp/a.gml"])).toThrow(/source-crs/);
    expect(() => parseGmlPrepareArguments(["--output", "/tmp/out.csv", "--source-crs", "EPSG:27700", "--input", "a=/tmp/a.gml", "--input", "a=/tmp/b.gml"])).toThrow(/unique/);
  });

  it("deduplicates parcels repeated across local-authority boundaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "surveynt-gml-"));
    temporaryDirectories.push(directory);
    const first = join(directory, "first.gml");
    const second = join(directory, "second.gml");
    const output = join(directory, "out.csv");
    await writeFile(first, `<wfs:FeatureCollection>${parcel()}</wfs:FeatureCollection>`);
    await writeFile(second, `<wfs:FeatureCollection>${parcel()}${parcel("456")}</wfs:FeatureCollection>`);
    const result = await prepareGml({ output, sourceCrs: "EPSG:27700", inputs: [{ authority: "first", path: first }, { authority: "second", path: second }] });
    expect(result.records).toBe(2);
    expect(result.duplicateRecords).toBe(1);
    expect((await readFile(output, "utf8")).match(/inspire:/g)).toHaveLength(2);
  });
});
