import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, dataSources, datasetSyncs, datasetVersions } from "../src/index";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const source = option("--source");
  const versionName = option("--version");
  if (!source || !versionName) throw new Error("Usage: --source <key> --version <previous-validated-version>");
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for rollback.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [target] = await db.select().from(datasetVersions).where(and(eq(datasetVersions.sourceKey, source), eq(datasetVersions.version, versionName))).limit(1);
  if (!target || !target.recordCount || target.validation.checksumVerified !== true) throw new Error("Rollback target is missing or was not successfully validated.");
  await db.transaction(async (tx) => {
    await tx.update(datasetVersions).set({ active: false, updatedAt: new Date() }).where(and(eq(datasetVersions.sourceKey, source), eq(datasetVersions.active, true)));
    await tx.update(datasetVersions).set({ active: true, activatedAt: new Date(), updatedAt: new Date() }).where(eq(datasetVersions.id, target.id));
    await tx.update(dataSources).set({ enabled: true, latestSuccessfulSyncAt: new Date(), updatedAt: new Date() }).where(eq(dataSources.key, source));
    await tx.insert(datasetSyncs).values({ sourceKey: source, datasetVersionId: target.id, status: "rolled_back", sourceUrl: target.sourceUrl, checksum: target.checksum, recordCount: target.recordCount, validation: { rollbackTarget: versionName, verified: true }, startedAt: new Date(), completedAt: new Date() });
    await tx.insert(auditEvents).values({ action: "property_data.version_rolled_back", resourceType: "dataset_version", resourceId: target.id, metadata: { source, version: versionName, checksum: target.checksum } });
  });
  console.log(`Activated ${source} version ${versionName}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
