import { createReadStream, createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
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
export type GeoJsonInput = { label: string; path: string };
export type PropertyFilter = { field: string; value: string };
export type PrepareArguments = { output: string; sourceCrs: "EPSG:4326"; inputs: GeoJsonInput[]; where?: PropertyFilter };

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
  let where: PropertyFilter | undefined;
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
    } else if (flag === "--where") {
      const separator = value.indexOf("=");
      if (separator < 1 || separator === value.length - 1) throw new Error("--where must use <property>=<value>.");
      where = { field: value.slice(0, separator), value: value.slice(separator + 1) };
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!output || sourceCrs !== "EPSG:4326" || !inputs.length) throw new Error("Usage: --output <csv> --source-crs EPSG:4326 --input <stable-label>=<geojson-path> [--input ...]");
  if (new Set(inputs.map(({ label }) => label)).size !== inputs.length) throw new Error("Input labels must be unique.");
  if (inputs.some(({ label }) => !/^[a-z0-9][a-z0-9_-]*$/.test(label))) throw new Error("Input labels may contain lowercase letters, numbers, underscores and hyphens only.");
  return { output, sourceCrs, inputs, where };
}

function validateCrsPreamble(preamble: string, sourceCrs: "EPSG:4326") {
  const declared = preamble.match(/"name"\s*:\s*"([^"]*(?:EPSG|CRS)[^"]*)"/i)?.[1];
  if (declared && !/(?:EPSG(?::|::)4326|CRS84)$/i.test(declared)) throw new Error(`GeoJSON declares unsupported CRS ${declared}; expected ${sourceCrs}.`);
}

export async function streamGeoJsonFeatures(path: string, sourceCrs: "EPSG:4326", visit: (feature: Feature) => Promise<void>) {
  let phase: "preamble" | "features" | "complete" = "preamble";
  let pending = "";
  let feature = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    pending += chunk;
    if (phase === "preamble") {
      const match = /"features"\s*:\s*\[/.exec(pending);
      if (!match) {
        if (pending.length > 1024 * 1024) throw new Error(`${path} has no FeatureCollection features array in its first MiB.`);
        continue;
      }
      const preamble = pending.slice(0, match.index);
      if (!/"type"\s*:\s*"FeatureCollection"/i.test(preamble)) throw new Error(`${path} is not a GeoJSON FeatureCollection.`);
      validateCrsPreamble(preamble, sourceCrs);
      pending = pending.slice(match.index + match[0].length);
      phase = "features";
    }
    if (phase !== "features") continue;
    for (let index = 0; index < pending.length; index += 1) {
      const char = pending[index];
      if (!feature) {
        if (char === "]") { phase = "complete"; pending = ""; break; }
        if (char !== "{") continue;
        feature = char;
        depth = 1;
        continue;
      }
      feature += char;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          await visit(JSON.parse(feature) as Feature);
          feature = "";
        }
      }
    }
    pending = "";
  }
  if (phase !== "complete" || feature) throw new Error(`${path} ended before its GeoJSON features array was complete.`);
}

function matchingProperty(properties: Record<string, unknown>, field: string) {
  const actual = Object.keys(properties).find((key) => key.toLowerCase() === field.toLowerCase());
  return actual ? properties[actual] : undefined;
}

export async function prepareGeoJson({ output, sourceCrs, inputs, where }: PrepareArguments) {
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
      perInput[input.label] = 0;
      let featureNumber = 0;
      await streamGeoJsonFeatures(input.path, sourceCrs, async (feature) => {
        featureNumber += 1;
        if (!feature.geometry) throw new Error(`${input.label} feature ${featureNumber} has no geometry.`);
        const properties = feature.properties ?? {};
        if (where && String(matchingProperty(properties, where.field) ?? "") !== where.value) return;
        const rawId = properties.ListEntry ?? properties.listentry ?? feature.id ?? properties.OBJECTID ?? properties.objectid;
        if (rawId === undefined || rawId === null || String(rawId).trim() === "") throw new Error(`${input.label} feature ${featureNumber} has no stable identifier.`);
        const sourceRecordId = `${input.label}:${rawId}`;
        const name = properties.Name ?? properties.name ?? null;
        const enrichedProperties = { ...properties, designationType: input.label };
        const row = [sourceRecordId, geometryToWkt(feature.geometry), name, JSON.stringify(enrichedProperties)].map(csv).join(",") + "\n";
        if (!stream.write(row)) await once(stream, "drain");
        records += 1;
        perInput[input.label] += 1;
      });
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
