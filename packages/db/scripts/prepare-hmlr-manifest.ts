import { createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

type CatalogueEntry = { href: string; rowText: string };
export type HmlrManifest = {
  source: "hmlr_inspire";
  coverage: "ENG";
  release: string;
  publishedAt: string;
  catalogueUrl: string;
  catalogueCount: number;
  excludedWelshAuthorities: number;
  entries: Array<{ authority: string; label: string; url: string; archive: string }>;
};

const catalogueOrigin = "https://use-land-property-data.service.gov.uk";
const cataloguePath = "/datasets/inspire/download";
const welshArchives = new Set([
  "Blaenau_Gwent_County_Borough_Council.zip", "Bridgend_County_Borough_Council.zip", "Caerphilly_County_Borough_Council.zip",
  "Cardiff_Council.zip", "Carmarthenshire_County_Council.zip", "Ceredigion_County_Council.zip", "Conwy_County_Borough_Council.zip",
  "Denbighshire_County_Council.zip", "Flintshire_County_Council.zip", "Gwynedd_Council.zip", "Isle_of_Anglesey_County_Council.zip",
  "Merthyr_Tydfil_County_Borough_Council.zip", "Monmouthshire_County_Council.zip", "Neath_Port_Talbot_County_Borough_Council.zip",
  "Newport_City_Council.zip", "Pembrokeshire_County_Council.zip", "Powys_County_Council.zip", "Rhondda_Cynon_Taf_County_Borough_Council.zip",
  "Swansea_Council.zip", "Torfaen_County_Borough_Council.zip", "Vale_of_Glamorgan_Council.zip", "Wrexham_County_Borough_Council.zip",
]);

function labelFor(archive: string) {
  return archive.replace(/\.zip$/i, "").toLowerCase().replaceAll("_", "-").replace(/[^a-z0-9-]/g, "");
}

export function buildHmlrManifest(input: unknown, release: string, publishedAt: string): HmlrManifest {
  if (!/^\d{4}-\d{2}$/.test(release) || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) throw new Error("Release must be YYYY-MM and publication date must be YYYY-MM-DD.");
  if (!Array.isArray(input)) throw new Error("Catalogue input must be a JSON array.");
  const entries = input as CatalogueEntry[];
  if (entries.length !== 318) throw new Error(`Expected 318 current England and Wales catalogue entries; found ${entries.length}.`);
  const seen = new Set<string>();
  let excludedWelshAuthorities = 0;
  const england: HmlrManifest["entries"] = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry.href !== "string" || typeof entry.rowText !== "string") throw new Error(`Catalogue entry ${index + 1} is malformed.`);
    const url = new URL(entry.href);
    const archive = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    if (url.protocol !== "https:" || url.origin !== catalogueOrigin || !url.pathname.startsWith(`${cataloguePath}/`) || url.search || url.hash || !/^[A-Za-z0-9_-]+\.zip$/.test(archive)) throw new Error(`Catalogue entry ${index + 1} has an unapproved download URL.`);
    if (seen.has(archive)) throw new Error(`Catalogue contains duplicate archive ${archive}.`);
    seen.add(archive);
    if (welshArchives.has(archive)) { excludedWelshAuthorities += 1; continue; }
    const authority = entry.rowText.split("\t")[0]?.trim();
    if (!authority) throw new Error(`Catalogue entry ${index + 1} has no authority name.`);
    england.push({ authority, label: labelFor(archive), url: url.href, archive });
  }
  const missingWelsh = [...welshArchives].filter((archive) => !seen.has(archive));
  if (missingWelsh.length) throw new Error(`Catalogue is missing Welsh exclusions: ${missingWelsh.join(", ")}`);
  if (excludedWelshAuthorities !== 22 || england.length !== 296) throw new Error(`Expected 296 England entries and 22 Welsh exclusions; found ${england.length} and ${excludedWelshAuthorities}.`);
  return { source: "hmlr_inspire", coverage: "ENG", release, publishedAt, catalogueUrl: `${catalogueOrigin}${cataloguePath}`, catalogueCount: entries.length, excludedWelshAuthorities, entries: england };
}

async function readStandardInput() {
  let content = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

function parseArguments(values: string[]) {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) options.set(values[index], values[index + 1]);
  const output = options.get("--output") ?? "";
  const release = options.get("--release") ?? "";
  const publishedAt = options.get("--published-at") ?? "";
  if (!output || !release || !publishedAt || options.size !== 3) throw new Error("Usage: --output <json> --release YYYY-MM --published-at YYYY-MM-DD (catalogue JSON is read from stdin)");
  return { output, release, publishedAt };
}

async function main() {
  const { output, release, publishedAt } = parseArguments(process.argv.slice(2));
  await access(dirname(output));
  try { await access(output); throw new Error(`Output already exists: ${output}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const manifest = buildHmlrManifest(JSON.parse(await readStandardInput()) as unknown, release, publishedAt);
  const stream = createWriteStream(output, { encoding: "utf8", flags: "wx" });
  stream.end(`${JSON.stringify(manifest, null, 2)}\n`);
  await once(stream, "finish");
  console.log(JSON.stringify({ output, entries: manifest.entries.length, excludedWelshAuthorities: manifest.excludedWelshAuthorities }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
