import { createReadStream, createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export type GmlInput = { authority: string; path: string };
export type GmlPrepareArguments = { output: string; sourceCrs: "EPSG:27700"; inputs: GmlInput[] };

function csv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function xml(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

function element(member: string, name: string) {
  const match = member.match(new RegExp(`<LR:${name}>([^<]*)<\\/LR:${name}>`, "i"));
  return match ? xml(match[1].trim()) : null;
}

function ring(block: string) {
  const match = block.match(/<gml:posList[^>]*>([^<]+)<\/gml:posList>/i);
  if (!match) throw new Error("GML polygon ring has no posList.");
  const values = match[1].trim().split(/\s+/).map(Number);
  if (values.length < 8 || values.length % 2 || values.some((value) => !Number.isFinite(value))) throw new Error("GML posList contains invalid two-dimensional coordinates.");
  const coordinates: string[] = [];
  for (let index = 0; index < values.length; index += 2) coordinates.push(`${values[index]} ${values[index + 1]}`);
  return `(${coordinates.join(",")})`;
}

export function gmlMemberToRecord(member: string, authority: string) {
  const srs = member.match(/<gml:Polygon[^>]*srsName="([^"]+)"/i)?.[1];
  if (!srs || !/EPSG::27700$/i.test(srs)) throw new Error(`GML polygon declares unsupported CRS ${srs ?? "unknown"}.`);
  const inspireId = element(member, "INSPIREID");
  if (!inspireId) throw new Error("GML parcel has no INSPIREID.");
  const exterior = member.match(/<gml:exterior>([\s\S]*?)<\/gml:exterior>/i)?.[1];
  if (!exterior) throw new Error(`GML parcel ${inspireId} has no exterior ring.`);
  const interiors = [...member.matchAll(/<gml:interior>([\s\S]*?)<\/gml:interior>/gi)].map((match) => ring(match[1]));
  const properties = {
    inspireId,
    label: element(member, "LABEL"),
    nationalCadastralReference: element(member, "NATIONALCADASTRALREFERENCE"),
    validFrom: element(member, "VALIDFROM"),
    beginLifespanVersion: element(member, "BEGINLIFESPANVERSION"),
    localAuthority: authority,
    boundaryStatus: "indicative_non_definitive",
  };
  return { sourceRecordId: `inspire:${inspireId}`, wkt: `POLYGON(${[ring(exterior), ...interiors].join(",")})`, properties };
}

export function parseGmlPrepareArguments(values: string[]): GmlPrepareArguments {
  let output = "";
  let sourceCrs = "";
  const inputs: GmlInput[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1] ?? "";
    if (flag === "--output") output = value;
    else if (flag === "--source-crs") sourceCrs = value;
    else if (flag === "--input") {
      const separator = value.indexOf("=");
      if (separator < 1 || separator === value.length - 1) throw new Error("Each --input must use <authority>=<gml-path>.");
      inputs.push({ authority: value.slice(0, separator), path: value.slice(separator + 1) });
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!output || sourceCrs !== "EPSG:27700" || !inputs.length) throw new Error("Usage: --output <csv> --source-crs EPSG:27700 --input <authority>=<gml-path> [--input ...]");
  if (new Set(inputs.map(({ authority }) => authority)).size !== inputs.length) throw new Error("Input authority labels must be unique.");
  return { output, sourceCrs, inputs };
}

async function members(path: string, visit: (member: string) => Promise<void>) {
  let buffer = "";
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    buffer += chunk;
    while (true) {
      const start = buffer.indexOf("<wfs:member>");
      if (start < 0) { if (buffer.length > 64) buffer = buffer.slice(-64); break; }
      const end = buffer.indexOf("</wfs:member>", start);
      if (end < 0) { if (start > 0) buffer = buffer.slice(start); break; }
      await visit(buffer.slice(start, end + "</wfs:member>".length));
      buffer = buffer.slice(end + "</wfs:member>".length);
    }
  }
  if (buffer.includes("<wfs:member>")) throw new Error(`${path} ended inside a GML member.`);
}

export async function prepareGml({ output, sourceCrs, inputs }: GmlPrepareArguments) {
  await access(dirname(output));
  try {
    await access(output);
    throw new Error(`Output already exists: ${output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const stream = createWriteStream(output, { encoding: "utf8", flags: "wx" });
  const seen = new Set<string>();
  let records = 0;
  let duplicateRecords = 0;
  const perInput: Record<string, number> = {};
  try {
    stream.write("source_record_id,wkt,name,properties_json\n");
    for (const input of inputs) {
      perInput[input.authority] = 0;
      await members(input.path, async (member) => {
        const record = gmlMemberToRecord(member, input.authority);
        if (seen.has(record.sourceRecordId)) { duplicateRecords += 1; return; }
        seen.add(record.sourceRecordId);
        const row = [record.sourceRecordId, record.wkt, null, JSON.stringify(record.properties)].map(csv).join(",") + "\n";
        if (!stream.write(row)) await once(stream, "drain");
        records += 1;
        perInput[input.authority] += 1;
      });
    }
    stream.end();
    await once(stream, "finish");
    return { output, sourceCrs, records, duplicateRecords, perInput };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

async function main() {
  const result = await prepareGml(parseGmlPrepareArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
