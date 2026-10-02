import { createWriteStream } from "node:fs";
import { access, rm } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { geometryToWkt } from "./prepare-spatial-geojson";

type Geometry = Parameters<typeof geometryToWkt>[0];
type OgcFeature = {
  id?: string | number;
  type?: string;
  geometry?: Geometry | null;
  properties?: Record<string, unknown> | null;
};
type OgcFeatureCollection = {
  type?: string;
  numberMatched?: number;
  numberReturned?: number;
  features?: OgcFeature[];
  links?: Array<{ rel?: string; href?: string }>;
};

export type OgcPrepareArguments = {
  endpoint: string;
  output: string;
  sourceCrs: "EPSG:4326";
  sourcePrefix: string;
  filterField: string;
  filterValue: string;
  pageSize: number;
  timeoutMs: number;
  rewritePaginationOrigin?: string;
};

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
type PrepareOptions = { fetcher?: Fetcher; wait?: (milliseconds: number) => Promise<void> };

function csv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function matchingProperty(properties: Record<string, unknown>, field: string) {
  const actual = Object.keys(properties).find((key) => key.toLowerCase() === field.toLowerCase());
  return actual ? properties[actual] : undefined;
}

function positiveInteger(value: string, flag: string, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${flag} must be an integer from 1 to ${maximum}.`);
  return parsed;
}

export function parseOgcArguments(values: string[]): OgcPrepareArguments {
  const parsed: Record<string, string> = {};
  const allowed = new Set(["--endpoint", "--output", "--source-crs", "--source-prefix", "--filter-field", "--filter-value", "--page-size", "--timeout-ms", "--rewrite-pagination-origin"]);
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag || !allowed.has(flag)) throw new Error(`Unknown option: ${flag ?? ""}`);
    if (!value) throw new Error(`${flag} requires a value.`);
    if (parsed[flag] !== undefined) throw new Error(`${flag} may only be specified once.`);
    parsed[flag] = value;
  }
  const endpoint = parsed["--endpoint"] ?? "";
  const output = parsed["--output"] ?? "";
  const sourceCrs = parsed["--source-crs"] ?? "";
  const sourcePrefix = parsed["--source-prefix"] ?? "";
  const filterField = parsed["--filter-field"] ?? "";
  const filterValue = parsed["--filter-value"] ?? "";
  if (!endpoint || !output || sourceCrs !== "EPSG:4326" || !sourcePrefix || !filterField || !filterValue) {
    throw new Error("Usage: --endpoint <OGC-items-URL> --output <csv> --source-crs EPSG:4326 --source-prefix <label> --filter-field <field> --filter-value <value> [--page-size 1000] [--timeout-ms 30000] [--rewrite-pagination-origin <https-origin>]");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("OGC endpoint must use HTTPS.");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(sourcePrefix)) throw new Error("Source prefix may contain lowercase letters, numbers, underscores and hyphens only.");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(filterField)) throw new Error("Filter field must be a simple OGC property name.");
  let rewritePaginationOrigin: string | undefined;
  if (parsed["--rewrite-pagination-origin"]) {
    const paginationOrigin = new URL(parsed["--rewrite-pagination-origin"]);
    if (paginationOrigin.protocol !== "https:" || paginationOrigin.pathname !== "/" || paginationOrigin.search || paginationOrigin.hash) throw new Error("Pagination rewrite origin must be an HTTPS origin without a path, query or fragment.");
    rewritePaginationOrigin = paginationOrigin.origin;
  }
  return {
    endpoint: url.href,
    output,
    sourceCrs: "EPSG:4326",
    sourcePrefix,
    filterField,
    filterValue,
    pageSize: positiveInteger(parsed["--page-size"] ?? "1000", "--page-size", 10_000),
    timeoutMs: positiveInteger(parsed["--timeout-ms"] ?? "30000", "--timeout-ms", 120_000),
    rewritePaginationOrigin,
  };
}

export function assertSafeNextUrl(candidate: string, collectionUrl: URL, rewriteOrigin?: string) {
  const next = new URL(candidate, collectionUrl);
  if (next.protocol !== "https:" || !new Set([collectionUrl.origin, rewriteOrigin].filter(Boolean)).has(next.origin) || next.pathname !== collectionUrl.pathname) {
    throw new Error(`OGC pagination link left the approved collection endpoint: ${next.href}`);
  }
  if (rewriteOrigin && next.origin === rewriteOrigin) {
    next.protocol = collectionUrl.protocol;
    next.host = collectionUrl.host;
  }
  return next;
}

function filterExpression(field: string, value: string) {
  return `${field}='${value.replaceAll("'", "''")}'`;
}

function retryable(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchPage(url: URL, timeoutMs: number, fetcher: Fetcher, wait: (milliseconds: number) => Promise<void>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url.href, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt === 3) throw new Error(`OGC request failed after ${attempt} attempts: ${error instanceof Error ? error.message : String(error)}`);
      await wait(250 * 2 ** (attempt - 1));
      continue;
    }
    if (response.ok) return response;
    if (!retryable(response.status) || attempt === 3) throw new Error(`OGC request returned HTTP ${response.status} for ${url.href}`);
    await response.body?.cancel();
    await wait(250 * 2 ** (attempt - 1));
  }
  throw new Error("OGC request exhausted its retry budget.");
}

function validateCollection(value: unknown, page: number): OgcFeatureCollection & { features: OgcFeature[] } {
  if (!value || typeof value !== "object") throw new Error(`OGC page ${page} is not a JSON object.`);
  const collection = value as OgcFeatureCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error(`OGC page ${page} is not a FeatureCollection.`);
  if (collection.numberReturned !== undefined && collection.numberReturned !== collection.features.length) throw new Error(`OGC page ${page} numberReturned does not match its feature count.`);
  if (collection.numberMatched !== undefined && (!Number.isSafeInteger(collection.numberMatched) || collection.numberMatched < 0)) throw new Error(`OGC page ${page} has an invalid numberMatched.`);
  return collection as OgcFeatureCollection & { features: OgcFeature[] };
}

export async function prepareOgcFeatures(arguments_: OgcPrepareArguments, options: PrepareOptions = {}) {
  await access(dirname(arguments_.output));
  try {
    await access(arguments_.output);
    throw new Error(`Output already exists: ${arguments_.output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const collectionUrl = new URL(arguments_.endpoint);
  collectionUrl.searchParams.set("limit", String(arguments_.pageSize));
  collectionUrl.searchParams.set("filter", filterExpression(arguments_.filterField, arguments_.filterValue));
  collectionUrl.searchParams.set("filter-lang", "cql2-text");
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const stream = createWriteStream(arguments_.output, { encoding: "utf8", flags: "wx" });
  const streamErrors: Error[] = [];
  stream.on("error", (error) => streamErrors.push(error));
  const visitedPages = new Set<string>();
  const identifiers = new Set<string>();
  let next: URL | undefined = collectionUrl;
  let expectedRecords: number | undefined;
  let records = 0;
  let pages = 0;

  try {
    stream.write("source_record_id,wkt,name,properties_json\n");
    while (next) {
      if (visitedPages.has(next.href)) throw new Error(`OGC pagination cycle detected at ${next.href}`);
      visitedPages.add(next.href);
      pages += 1;
      const response = await fetchPage(next, arguments_.timeoutMs, fetcher, wait);
      const collection = validateCollection(await response.json(), pages);
      if (collection.numberMatched !== undefined) {
        if (expectedRecords !== undefined && collection.numberMatched !== expectedRecords) throw new Error("OGC numberMatched changed while downloading the collection.");
        expectedRecords = collection.numberMatched;
      }
      for (const [index, feature] of collection.features.entries()) {
        if (feature.type !== undefined && feature.type !== "Feature") throw new Error(`OGC page ${pages} feature ${index + 1} is not a Feature.`);
        if (feature.id === undefined || feature.id === null || String(feature.id).trim() === "") throw new Error(`OGC page ${pages} feature ${index + 1} has no stable identifier.`);
        if (!feature.geometry) throw new Error(`OGC feature ${feature.id} has no geometry.`);
        const rawIdentifier = String(feature.id);
        if (identifiers.has(rawIdentifier)) throw new Error(`OGC returned duplicate feature identifier ${rawIdentifier}.`);
        identifiers.add(rawIdentifier);
        const properties = feature.properties ?? {};
        const actualFilter = matchingProperty(properties, arguments_.filterField);
        if (String(actualFilter ?? "") !== arguments_.filterValue) throw new Error(`OGC feature ${rawIdentifier} did not match ${arguments_.filterField}=${arguments_.filterValue}.`);
        const name = properties.name ?? properties.Name ?? null;
        const enrichedProperties = { ...properties, datasetLayer: arguments_.sourcePrefix };
        const row = [`${arguments_.sourcePrefix}:${rawIdentifier}`, geometryToWkt(feature.geometry), name, JSON.stringify(enrichedProperties)].map(csv).join(",") + "\n";
        if (!stream.write(row)) await once(stream, "drain");
        records += 1;
      }
      const nextLink = collection.links?.find(({ rel }) => rel === "next")?.href;
      next = nextLink ? assertSafeNextUrl(nextLink, collectionUrl, arguments_.rewritePaginationOrigin) : undefined;
    }
    if (expectedRecords === undefined) throw new Error("OGC service did not report numberMatched.");
    if (records !== expectedRecords) throw new Error(`OGC download ended with ${records} records; expected ${expectedRecords}.`);
    stream.end();
    await once(stream, "finish");
    if (streamErrors.length) throw streamErrors[0];
    return { output: arguments_.output, sourceCrs: arguments_.sourceCrs, records, pages, expectedRecords, endpoint: collectionUrl.origin + collectionUrl.pathname };
  } catch (error) {
    if (!stream.destroyed) stream.destroy();
    if (!stream.closed) await new Promise<void>((resolve) => stream.once("close", resolve));
    await rm(arguments_.output, { force: true });
    throw error;
  }
}

async function main() {
  const result = await prepareOgcFeatures(parseOgcArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
