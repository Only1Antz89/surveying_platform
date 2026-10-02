import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, dataSources, datasetSyncs, datasetVersions } from "../src/index";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const source = option("--source");
  const versionName = option("--version");
  const capacityApproved = option("--capacity-approved") === "true";
  if (!source || !versionName || !capacityApproved) throw new Error("Usage: --source <key> --version <staged-version> --capacity-approved true");
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for activation.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [target] = await db.select().from(datasetVersions).where(and(eq(datasetVersions.sourceKey, source), eq(datasetVersions.layer, ""), eq(datasetVersions.version, versionName))).limit(1);
  if (!target || target.active || !target.recordCount) throw new Error("Activation target must be a non-empty, inactive staged version.");
  const validation = target.validation as { checksumVerified?: boolean; measuredCapacity?: { projectedStorageUsdPerMonth?: number | null } };
  const licence = target.licenceSnapshot as { confirmedAt?: string };
  if (validation.checksumVerified !== true || !validation.measuredCapacity) throw new Error("Activation target lacks a verified checksum or measured capacity report.");
  if (validation.measuredCapacity.projectedStorageUsdPerMonth === null || validation.measuredCapacity.projectedStorageUsdPerMonth === undefined) throw new Error("Activation target lacks a projected Neon storage cost.");
  if (!licence.confirmedAt) throw new Error("Activation target lacks recorded licence confirmation.");

  await db.transaction(async (tx) => {
    // These scripts manage single-layer sources only; layered sources are activated through @surveynt/property-data.
    const [current] = await tx.update(datasetVersions).set({ active: false, retiredAt: new Date(), updatedAt: new Date() }).where(and(eq(datasetVersions.sourceKey, source), eq(datasetVersions.layer, ""), eq(datasetVersions.active, true))).returning({ id: datasetVersions.id });
    await tx.update(datasetVersions).set({ active: true, activatedAt: new Date(), retiredAt: null, previousActiveId: current?.id ?? target.previousActiveId, updatedAt: new Date(), validation: { ...target.validation, capacityApproved: true, capacityApprovedAt: new Date().toISOString() } }).where(eq(datasetVersions.id, target.id));
    await tx.update(dataSources).set({ enabled: true, latestSuccessfulSyncAt: new Date(), updatedAt: new Date() }).where(eq(dataSources.key, source));
    await tx.insert(datasetSyncs).values({ sourceKey: source, datasetVersionId: target.id, status: "active", sourceUrl: target.sourceUrl, checksum: target.checksum, recordCount: target.recordCount, validation: { activation: true, capacityApproved: true, measuredCapacity: validation.measuredCapacity }, startedAt: new Date(), completedAt: new Date() });
    await tx.insert(auditEvents).values({ action: "property_data.version_activated", resourceType: "dataset_version", resourceId: target.id, metadata: { source, version: versionName, checksum: target.checksum, capacityApproved: true } });
  });
  console.log(`Activated ${source} version ${versionName}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
