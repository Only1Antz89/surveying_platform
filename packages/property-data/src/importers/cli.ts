// Operator CLI for reference data. Runs outside Vercel with the importer role
// (DATABASE_IMPORTER_URL). Registry sync and rollback use the owner role
// (DATABASE_ADMIN_URL) because they change operator-controlled metadata.
import { parseArgs } from "node:util";
import { createDatabase } from "@surveynt/db";
import { activateSync, pruneRetiredSyncs, rollbackSource, syncSourceRegistry } from "../db/reference";
import { importOsOpenUprn, type Bbox } from "./os-open-uprn";

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
    file: { type: "string" }, version: { type: "string" }, "source-url": { type: "string" }, bbox: { type: "string" },
    activate: { type: "boolean", default: false }, sync: { type: "string" }, source: { type: "string" }, keep: { type: "string" },
  } });
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
    case "activate": {
      if (!values.sync) throw new Error("--sync is required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      console.log(JSON.stringify(await activateSync(db, values.sync), null, 2));
      break;
    }
    case "rollback": {
      if (!values.source) throw new Error("--source is required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      console.log(JSON.stringify(await rollbackSource(db, values.source), null, 2));
      break;
    }
    case "prune": {
      if (!values.source) throw new Error("--source is required.");
      const db = createDatabase(requireEnv("DATABASE_IMPORTER_URL"));
      console.log(`Removed ${await pruneRetiredSyncs(db, values.source, Number(values.keep ?? 2))} old versions.`);
      break;
    }
    default:
      throw new Error("Commands: registry-sync | os-open-uprn --file --version [--bbox] [--activate] | activate --sync | rollback --source | prune --source [--keep]");
  }
}

main().then(() => process.exit(process.exitCode ?? 0), (reason) => {
  console.error(reason instanceof Error ? reason.message : reason);
  process.exit(1);
});
