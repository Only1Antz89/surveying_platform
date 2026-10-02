// Operator CLI for reference data. Runs outside Vercel with the importer role
// (DATABASE_IMPORTER_URL). Registry sync and rollback use the owner role
// (DATABASE_ADMIN_URL) because they change operator-controlled metadata.
import { parseArgs } from "node:util";
import { createDatabase } from "@surveynt/db";
import { activateSyncAndInvalidate, rollbackAndInvalidate } from "../db/operations";
import { pruneRetiredSyncs, syncSourceRegistry } from "../db/reference";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importOsOpenUprn, type Bbox } from "./os-open-uprn";
import { importPricePaid, importPricePaidUprnLookup, parsePostcodeAreas } from "./price-paid";
import { importScottishEpc, scottishEpcColumns, type ScottishEpcField } from "./scottish-epc";
import { importSpatialLayer } from "./spatial-layer";

/** Converts a shapefile, GML or GeoPackage to GeoJSONSeq in EPSG:4326 using GDAL (no shell). */
async function convertWithOgr(input: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "surveynt-layer-"));
  const output = path.join(directory, "layer.geojsonl");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ogr2ogr", ["-f", "GeoJSONSeq", "-t_srs", "EPSG:4326", "-lco", "RS=NO", output, input], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`ogr2ogr exited with ${code}`)));
  });
  return output;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this command.`);
  return value;
}

function parseBbox(value: string | undefined): Bbox | undefined {
  if (!value) return undefined;
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = value.split(",").map(Number);
  if ([minLongitude, minLatitude, maxLongitude, maxLatitude].some((item) => !Number.isFinite(item)) || minLongitude >= maxLongitude || minLatitude >= maxLatitude) throw new Error("--bbox must be minLon,minLat,maxLon,maxLat");
  return { minLongitude, minLatitude, maxLongitude, maxLatitude };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, options: {
    file: { type: "string" }, version: { type: "string" }, "source-url": { type: "string" }, bbox: { type: "string" }, layer: { type: "string" }, convert: { type: "boolean", default: false }, "source-crs": { type: "string" }, "id-property": { type: "string" }, "name-property": { type: "string" }, attributes: { type: "string" },
    activate: { type: "boolean", default: false }, sync: { type: "string" }, source: { type: "string" }, keep: { type: "string" },
    column: { type: "string", multiple: true },
    mode: { type: "string" }, "postcode-areas": { type: "string" }, "max-rejected": { type: "string" }, "transaction-column": { type: "string" }, "uprn-column": { type: "string" },
  } });
  const maxRejected = values["max-rejected"] === undefined ? undefined : Number(values["max-rejected"]);
  if (maxRejected !== undefined && (!Number.isInteger(maxRejected) || maxRejected < 0)) throw new Error("--max-rejected must be a whole number.");
  switch (command) {
    case "registry-sync": {
      const db = createDatabase(requireEnv("DATABASE_ADMIN_URL"));
      console.log(`Upserted ${await syncSourceRegistry(db)} source definitions. Enablement is unchanged.`);
      break;
    }
    case "os-open-uprn": {
      if (!values.file || !values.version) throw new Error("--file and --version are required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      const outcome = await importOsOpenUprn(db, { filePath: values.file, datasetVersion: values.version, sourceUrl: values["source-url"], bbox: parseBbox(values.bbox), activate: values.activate, importedBy: process.env.USER ?? "operator" });
      console.log(JSON.stringify(outcome, null, 2));
      if (outcome.status === "failed") process.exitCode = 1;
      break;
    }
    case "spatial-layer": {
      if (!values.source || !values.layer || !values.file || !values.version) throw new Error("--source, --layer, --file and --version are required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      const filePath = values.convert ? await convertWithOgr(values.file) : values.file;
      // Attribute names differ between releases: an operator may override the preset after inspecting the file.
      const preset = values["id-property"] ? { idProperty: values["id-property"], nameProperty: values["name-property"], keepProperties: (values.attributes ?? "").split(",").map((item) => item.trim()).filter(Boolean) } : undefined;
      const outcome = await importSpatialLayer(db, { sourceKey: values.source, layer: values.layer, filePath, datasetVersion: values.version, sourceUrl: values["source-url"], sourceCrs: values["source-crs"], preset, activate: values.activate, importedBy: process.env.USER ?? "operator" });
      console.log(JSON.stringify(outcome, null, 2));
      if (outcome.status === "failed") process.exitCode = 1;
      break;
    }
    case "price-paid": {
      if (!values.file || !values.version) throw new Error("--file and --version (the release date, for example 2026-09) are required.");
      if (values.mode !== "full" && values.mode !== "update") throw new Error("--mode must be full (complete or yearly file) or update (monthly change file).");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      const outcome = await importPricePaid(db, { filePath: values.file, datasetVersion: values.version, mode: values.mode, postcodeAreas: parsePostcodeAreas(values["postcode-areas"]), sourceUrl: values["source-url"], maxRejected, activate: values.activate, importedBy: process.env.USER ?? "operator" });
      console.log(JSON.stringify(outcome, null, 2));
      if (outcome.status === "failed") process.exitCode = 1;
      break;
    }
    case "price-paid-lookup": {
      if (!values.file || !values.version) throw new Error("--file and --version are required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      const outcome = await importPricePaidUprnLookup(db, { filePath: values.file, datasetVersion: values.version, transactionColumn: values["transaction-column"], uprnColumn: values["uprn-column"], sourceUrl: values["source-url"], maxRejected, activate: values.activate, importedBy: process.env.USER ?? "operator" });
      console.log(JSON.stringify(outcome, null, 2));
      if (outcome.status === "failed") process.exitCode = 1;
      break;
    }
    case "scottish-epc": {
      if (!values.file || !values.version) throw new Error("--file and --version are required.");
      const columns: Partial<Record<ScottishEpcField, string>> = {};
      for (const entry of values.column ?? []) {
        const [field, header] = entry.split("=");
        if (!(field in scottishEpcColumns) || !header) throw new Error(`--column must be field=Header with field one of ${Object.keys(scottishEpcColumns).join(", ")}.`);
        columns[field as ScottishEpcField] = header;
      }
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      const outcome = await importScottishEpc(db, { filePath: values.file, datasetVersion: values.version, columns, sourceUrl: values["source-url"], maxRejected, activate: values.activate, importedBy: process.env.USER ?? "operator" });
      console.log(JSON.stringify(outcome, null, 2));
      if (outcome.status === "failed") process.exitCode = 1;
      break;
    }
    case "activate": {
      if (!values.sync) throw new Error("--sync is required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      console.log(JSON.stringify(await activateSyncAndInvalidate(db, values.sync), null, 2));
      break;
    }
    case "rollback": {
      if (!values.source) throw new Error("--source is required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      console.log(JSON.stringify(await rollbackAndInvalidate(db, values.source, values.layer ?? ""), null, 2));
      break;
    }
    case "prune": {
      if (!values.source) throw new Error("--source is required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      console.log(`Removed ${await pruneRetiredSyncs(db, values.source, Number(values.keep ?? 2), values.layer ?? "")} old versions.`);
      break;
    }
    default:
      throw new Error("Commands: registry-sync | os-open-uprn --file --version [--bbox] [--activate] | spatial-layer --source --layer --file --version [--convert] [--activate] | price-paid --file --version --mode full|update [--postcode-areas BS,BA] [--max-rejected N] [--activate] | price-paid-lookup --file --version [--transaction-column --uprn-column] [--activate] | scottish-epc --file --version [--column field=Header ...] [--activate] | activate --sync | rollback --source [--layer] | prune --source [--layer] [--keep N]. spatial-layer also accepts --id-property --name-property --attributes a,b");
  }
}

main().then(() => process.exit(process.exitCode ?? 0), (reason) => {
  console.error(reason instanceof Error ? reason.message : reason);
  process.exit(1);
});
