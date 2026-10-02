import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { eq, sql } from "drizzle-orm";
import { datasetSyncs, type Database } from "@surveynt/db";
import { activateSync } from "../db/reference";
import { getSourceDefinition } from "../registry/sources";
import { sha256File, type ImportOutcome } from "./os-open-uprn";

// Shared staging for tabular reference imports: a new dataset_syncs row, rows
// loaded under it, validation, optional activation, and full clean-up on failure.

export type StagedTable = "price_paid_transactions" | "price_paid_uprn_links" | "scottish_epc_certificates";

type StagedSync = typeof datasetSyncs.$inferSelect;

export async function createSync(db: Database, sourceKey: string, options: { filePath: string; datasetVersion: string; sourceUrl?: string; importedBy: string; extent: string }) {
  const definition = getSourceDefinition(sourceKey);
  if (!definition) throw new Error(`${sourceKey} is not registered.`);
  const checksum = await sha256File(options.filePath);
  const [sync] = await db.insert(datasetSyncs).values({
    sourceKey, datasetVersion: options.datasetVersion, sourceUrl: options.sourceUrl ?? definition.accessUrls[0] ?? null, checksum,
    licence: definition.licence as unknown as Record<string, unknown>, sourceCrs: null, extent: options.extent, importedBy: options.importedBy,
  }).returning();
  return sync;
}

export async function finish(db: Database, sync: StagedSync, table: StagedTable, run: () => Promise<{ stored: number; skipped: number; validation: Record<string, unknown> }>, activate: boolean | undefined): Promise<ImportOutcome> {
  let skipped = 0;
  try {
    const outcome = await run();
    skipped = outcome.skipped;
    await db.update(datasetSyncs).set({ recordCount: outcome.stored, validation: outcome.validation, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
    if (activate) {
      await activateSync(db, sync.id);
      return { syncId: sync.id, status: "active", recordCount: outcome.stored, skipped, validation: outcome.validation };
    }
    return { syncId: sync.id, status: "staging", recordCount: outcome.stored, skipped, validation: outcome.validation };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message.slice(0, 1000) : "Import failed.";
    const validation = (reason as { validation?: Record<string, unknown> }).validation ?? {};
    await db.execute(sql`delete from ${sql.identifier("reference")}.${sql.identifier(table)} where dataset_sync_id = ${sync.id}`);
    await db.update(datasetSyncs).set({ status: "failed", error: message, validation, completedAt: new Date() }).where(eq(datasetSyncs.id, sync.id));
    return { syncId: sync.id, status: "failed", recordCount: 0, skipped, validation, error: message };
  }
}

export async function countRows(db: Database, table: StagedTable, syncId: string) {
  const result = await db.execute(sql`select count(*)::int as count from ${sql.identifier("reference")}.${sql.identifier(table)} where dataset_sync_id = ${syncId}`);
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

