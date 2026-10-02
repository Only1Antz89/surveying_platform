import { createWriteStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

type Position = number[];
type Geometry = {
  type: "Point" | "MultiPoint" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon" | "GeometryCollection";
  coordinates?: unknown;
  geometries?: Geometry[];
};

type Feature = { id?: string | number; geometry?: Geometry | null; properties?: Record<string, unknown> | null };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[]; crs?: { properties?: { name?: string } } };
export type GeoJsonInput = { label: string; path: string };
export type PrepareArguments = { output: string; sourceCrs: "EPSG:4326"; inputs: GeoJsonInput[] };

function coordinate(position: Position) {
  if (position.length < 2 || !position.slice(0, 2).every(Number.isFinite)) throw new Error("Geometry contains a non-finite or incomplete coordinate.");
  return `${position[0]} ${position[1]}`;
}

function positions(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Geometry coordinates must be an array.");
  return value as unknown[];
}

function coordinateList(value: unknown) {
  return positions(value).map((item) => coordinate(item as Position)).join(",");
}

function nestedCoordinateList(value: unknown) {
  return positions(value).map((item) => `(${coordinateList(item)})`).join(",");
}

export function geometryToWkt(geometry: Geometry): string {
  switch (geometry.type) {
    case "Point": return `POINT(${coordinate(geometry.coordinates as Position)})`;
    case "MultiPoint": return `MULTIPOINT(${positions(geometry.coordinates).map((item) => `(${coordinate(item as Position)})`).join(",")})`;
    case "LineString": return `LINESTRING(${coordinateList(geometry.coordinates)})`;
    case "MultiLineString": return `MULTILINESTRING(${nestedCoordinateList(geometry.coordinates)})`;
    case "Polygon": return `POLYGON(${nestedCoordinateList(geometry.coordinates)})`;
    case "MultiPolygon": return `MULTIPOLYGON(${positions(geometry.coordinates).map((polygon) => `(${nestedCoordinateList(polygon)})`).join(",")})`;
    case "GeometryCollection": return `GEOMETRYCOLLECTION(${(geometry.geometries ?? []).map(geometryToWkt).join(",")})`;
    default: throw new Error(`Unsupported GeoJSON geometry type: ${(geometry as Geometry).type}`);
  }
}

function csv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function parsePrepareArguments(values: string[]): PrepareArguments {
  let output = "";
  let sourceCrs = "";
  const inputs: GeoJsonInput[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1] ?? "";
    if (flag === "--output") output = value;
    else if (flag === "--source-crs") sourceCrs = value;
    else if (flag === "--input") {
      const separator = value.indexOf("=");
      if (separator < 1 || separator === value.length - 1) throw new Error("Each --input must use <stable-label>=<geojson-path>.");
      inputs.push({ label: value.slice(0, separator), path: value.slice(separator + 1) });
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!output || sourceCrs !== "EPSG:4326" || !inputs.length) throw new Error("Usage: --output <csv> --source-crs EPSG:4326 --input <stable-label>=<geojson-path> [--input ...]");
  if (new Set(inputs.map(({ label }) => label)).size !== inputs.length) throw new Error("Input labels must be unique.");
  if (inputs.some(({ label }) => !/^[a-z0-9][a-z0-9_-]*$/.test(label))) throw new Error("Input labels may contain lowercase letters, numbers, underscores and hyphens only.");
  return { output, sourceCrs, inputs };
}

function validateCrs(collection: FeatureCollection, sourceCrs: "EPSG:4326") {
  const declared = collection.crs?.properties?.name;
  if (declared && !/(?:EPSG(?::|::)4326|CRS84)$/i.test(declared)) throw new Error(`GeoJSON declares unsupported CRS ${declared}; expected ${sourceCrs}.`);
}

export async function prepareGeoJson({ output, sourceCrs, inputs }: PrepareArguments) {
  await access(dirname(output));
  try {
    await access(output);
    throw new Error(`Output already exists: ${output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const stream = createWriteStream(output, { encoding: "utf8", flags: "wx" });
  let records = 0;
  const perInput: Record<string, number> = {};
  try {
    stream.write("source_record_id,wkt,name,properties_json\n");
    for (const input of inputs) {
      const collection = JSON.parse(await readFile(input.path, "utf8")) as FeatureCollection;
      if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error(`${input.path} is not a GeoJSON FeatureCollection.`);
      validateCrs(collection, sourceCrs);
      perInput[input.label] = 0;
      for (let index = 0; index < collection.features.length; index += 1) {
        const feature = collection.features[index];
        if (!feature.geometry) throw new Error(`${input.label} feature ${index + 1} has no geometry.`);
        const properties = feature.properties ?? {};
        const rawId = properties.ListEntry ?? properties.listentry ?? feature.id ?? properties.OBJECTID ?? properties.objectid;
        if (rawId === undefined || rawId === null || String(rawId).trim() === "") throw new Error(`${input.label} feature ${index + 1} has no stable identifier.`);
        const sourceRecordId = `${input.label}:${rawId}`;
        const name = properties.Name ?? properties.name ?? null;
        const enrichedProperties = { ...properties, designationType: input.label };
        const row = [sourceRecordId, geometryToWkt(feature.geometry), name, JSON.stringify(enrichedProperties)].map(csv).join(",") + "\n";
        if (!stream.write(row)) await once(stream, "drain");
        records += 1;
        perInput[input.label] += 1;
      }
    }
    stream.end();
    await once(stream, "finish");
    return { output, sourceCrs, records, perInput };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

async function main() {
  const result = await prepareGeoJson(parsePrepareArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
