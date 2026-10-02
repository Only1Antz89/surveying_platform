import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { eq, sql } from "drizzle-orm";
import { datasetVersions, type Database } from "@surveynt/db";
import { activateSync, logSync, toReferenceVersion, type ReferenceVersion } from "../db/reference";
import { getSourceDefinition } from "../registry/sources";
import { sha256File, type ImportOutcome } from "./os-open-uprn";

// Shared staging for reference imports: a new dataset_versions row (inactive),
// rows loaded under it, validation, optional activation. A failed import is
// deleted with its rows, as the England import scripts do, and the job log
// (dataset_syncs) records why. The active version is never touched.

export type StagedTable = "os_uprn_points" | "spatial_reference_features" | "price_paid_transactions" | "price_paid_uprn_links" | "scottish_epc_certificates";

export async function createVersion(db: Database, sourceKey: string, options: { datasetVersion: string; layer?: string; checksum: string; sourceUrl?: string; sourceCrs?: string | null; importedBy: string; extent: string }) {
  const definition = getSourceDefinition(sourceKey);
  if (!definition) throw new Error(`${sourceKey} is not registered.`);
  const [row] = await db.insert(datasetVersions).values({
    sourceKey, layer: options.layer ?? "", version: options.datasetVersion, checksum: options.checksum,
    sourceUrl: options.sourceUrl ?? definition.accessUrls.find((url) => url.startsWith("http")) ?? definition.documentationUrl,
    licenceSnapshot: definition.licence as unknown as Record<string, unknown>, sourceCrs: options.sourceCrs ?? null, extent: options.extent, importedBy: options.importedBy,
  }).returning();
  const version = toReferenceVersion(row);
  await logSync(db, version, "validating");
  return version;
}

export async function createSync(db: Database, sourceKey: string, options: { filePath: string; datasetVersion: string; sourceUrl?: string; importedBy: string; extent: string }) {
  return createVersion(db, sourceKey, { ...options, checksum: await sha256File(options.filePath) });
}

export async function completeVersion(db: Database, version: ReferenceVersion, outcome: { stored: number; skipped: number; validation: Record<string, unknown> }, activate: boolean | undefined): Promise<ImportOutcome> {
  const [row] = await db.update(datasetVersions).set({ recordCount: outcome.stored, validation: outcome.validation, completedAt: new Date(), updatedAt: new Date() }).where(eq(datasetVersions.id, version.id)).returning();
  if (activate) {
    await activateSync(db, version.id);
    return { syncId: version.id, status: "active", recordCount: outcome.stored, skipped: outcome.skipped, validation: outcome.validation };
  }
  await logSync(db, toReferenceVersion(row), "staged");
  return { syncId: version.id, status: "staging", recordCount: outcome.stored, skipped: outcome.skipped, validation: outcome.validation };
}

export async function failVersion(db: Database, version: ReferenceVersion, reason: unknown, skipped: number, fallbackValidation: Record<string, unknown> = {}): Promise<ImportOutcome> {
  const message = reason instanceof Error ? reason.message.slice(0, 1000) : "Import failed.";
  const validation = (reason as { validation?: Record<string, unknown> }).validation ?? fallbackValidation;
  await db.delete(datasetVersions).where(eq(datasetVersions.id, version.id));
  await logSync(db, { ...version, recordCount: 0, validation: { ...validation, datasetVersion: version.datasetVersion, layer: version.layer } }, "failed", message);
  return { syncId: version.id, status: "failed", recordCount: 0, skipped, validation, error: message };
}

export async function finish(db: Database, version: ReferenceVersion, _table: StagedTable, run: () => Promise<{ stored: number; skipped: number; validation: Record<string, unknown> }>, activate: boolean | undefined): Promise<ImportOutcome> {
  try {
    return await completeVersion(db, version, await run(), activate);
  } catch (reason) {
    return failVersion(db, version, reason, 0);
  }
}

export async function countRows(db: Database, table: StagedTable, syncId: string) {
  const result = await db.execute(sql`select count(*)::int as count from ${sql.identifier(table)} where dataset_version_id = ${syncId}`);
  return Number((result as unknown as { rows: { count: number }[] }).rows[0]?.count ?? 0);
}

export async function* lines(filePath: string) {
  let number = 0;
  for await (const raw of createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })) {
    number += 1;
    const line = raw.replace(/^﻿/, "").trim();
    if (line) yield { line, number };
  }
}

export function rejectionError(rejected: { line: number; reason: string }[], total: number, maxRejected: number, validation: Record<string, unknown>) {
  return Object.assign(new Error(`${total} rows were rejected (allowed ${maxRejected}). First: ${rejected.map((item) => `line ${item.line}: ${item.reason}`).join("; ")}.`), { validation });
}

