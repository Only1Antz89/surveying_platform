import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { eq, sql } from "drizzle-orm";
import { datasetSyncs, type Database } from "@surveynt/db";
import { activateSync, getActiveSync } from "../db/reference";
import { isValidUprn, normalisePostcode } from "../matching/identity";
import { getSourceDefinition } from "../registry/sources";
import { parseCsvLine } from "./csv";
import { sha256File, type ImportOutcome } from "./os-open-uprn";

export const PRICE_PAID_SOURCE = "hmlr_price_paid";
export const PRICE_PAID_LOOKUP_SOURCE = "hmlr_ppd_uprn_lookup";

const transactionPattern = /^\{?([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\}?$/i;

/** Normalises a Price Paid transaction unique identifier ("{GUID}") to an upper-case GUID without braces. */
export function normaliseTransactionId(raw: string) {
  const match = transactionPattern.exec(raw.trim());
  return match ? match[1].toUpperCase() : null;
}

/** UPRNs are numeric identifiers; leading zeros carry no meaning. */
export function normaliseUprn(raw: string) {
  const value = raw.trim().replace(/^0+(?=\d)/, "");
  return isValidUprn(value) ? value : null;
}

export type PricePaidRow = {
  transactionId: string;
  price: number;
  transferDate: string;
  propertyType: "D" | "S" | "T" | "F" | "O";
  newBuild: boolean;
  tenure: "F" | "L" | "U";
  ppdCategory: "A" | "B";
};

export type ParsedPricePaidLine =
  | { ok: true; recordStatus: "A" | "C" | "D"; row: PricePaidRow; postcodeArea: string | null }
  | { ok: true; recordStatus: "D"; row: null; transactionId: string; postcodeArea: string | null }
  | { ok: false; reason: string };

/**
 * Price Paid CSV has no header and 16 columns: transaction id, price, date of
 * transfer, postcode, property type, old/new, duration, PAON, SAON, street,
 * locality, town, district, county, PPD category, record status.
 *
 * Address columns (postcode to county) are read only to filter a regional
 * import by postcode area and are never returned or stored. Rejection reasons
 * never quote field values.
 */
export function parsePricePaidLine(line: string): ParsedPricePaidLine {
  const fields = parseCsvLine(line);
  if (!fields) return { ok: false, reason: "unterminated quote" };
  if (fields.length !== 16) return { ok: false, reason: `expected 16 columns, found ${fields.length}` };
  const transactionId = normaliseTransactionId(fields[0]);
  if (!transactionId) return { ok: false, reason: "invalid transaction id" };
  const recordStatus = fields[15].trim().toUpperCase();
  if (recordStatus !== "A" && recordStatus !== "C" && recordStatus !== "D") return { ok: false, reason: "invalid record status" };
  const postcode = normalisePostcode(fields[3]);
  const postcodeArea = postcode ? /^[A-Z]{1,2}/.exec(postcode)?.[0] ?? null : null;
  const price = Number(fields[1].trim());
  const transferDate = fields[2].trim().slice(0, 10);
  const propertyType = fields[4].trim().toUpperCase();
  const oldNew = fields[5].trim().toUpperCase();
  const tenure = fields[6].trim().toUpperCase();
  const ppdCategory = fields[14].trim().toUpperCase();
  const valid = Number.isInteger(price) && price > 0 && price <= 2_147_483_647
    && /^\d{4}-\d{2}-\d{2}$/.test(transferDate) && !Number.isNaN(Date.parse(`${transferDate}T00:00:00Z`))
    && ["D", "S", "T", "F", "O"].includes(propertyType) && (oldNew === "Y" || oldNew === "N")
    && ["F", "L", "U"].includes(tenure) && (ppdCategory === "A" || ppdCategory === "B");
  if (!valid) {
    // A deletion only needs its transaction id.
    if (recordStatus === "D") return { ok: true, recordStatus: "D", row: null, transactionId, postcodeArea };
    return { ok: false, reason: "invalid price, date, type, old/new, duration or category" };
  }
  return {
    ok: true,
    recordStatus,
    postcodeArea,
    row: { transactionId, price, transferDate, propertyType: propertyType as PricePaidRow["propertyType"], newBuild: oldNew === "Y", tenure: tenure as PricePaidRow["tenure"], ppdCategory: ppdCategory as PricePaidRow["ppdCategory"] },
  };
}

const extentPrefix = "postcode areas: ";

export function parsePostcodeAreas(value: string | undefined) {
  if (!value) return undefined;
  const areas = [...new Set(value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))].sort();
  if (!areas.length || areas.some((area) => !/^[A-Z]{1,2}$/.test(area))) throw new Error("Postcode areas must be one or two letters, for example BS,BA.");
  return areas;
}

/** Postcode areas covered by a Price Paid sync, or null when the whole file was imported. */
export function postcodeAreasFromExtent(extent: string | null) {
  return extent?.startsWith(extentPrefix) ? extent.slice(extentPrefix.length).split(",") : null;
}

type StagedSync = typeof datasetSyncs.$inferSelect;

async function createSync(db: Database, sourceKey: string, options: { filePath: string; datasetVersion: string; sourceUrl?: string; importedBy: string; extent: string }) {
  const definition = getSourceDefinition(sourceKey);
  if (!definition) throw new Error(`${sourceKey} is not registered.`);
  const checksum = await sha256File(options.filePath);
  const [sync] = await db.insert(datasetSyncs).values({
    sourceKey, datasetVersion: options.datasetVersion, sourceUrl: options.sourceUrl ?? definition.accessUrls[0] ?? null, checksum,
    licence: definition.licence as unknown as Record<string, unknown>, sourceCrs: null, extent: options.extent, importedBy: options.importedBy,
  }).returning();
  return sync;
}

async function finish(db: Database, sync: StagedSync, table: "price_paid_transactions" | "price_paid_uprn_links", run: () => Promise<{ stored: number; skipped: number; validation: Record<string, unknown> }>, activate: boolean | undefined): Promise<ImportOutcome> {
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

async function countRows(db: Database, table: "price_paid_transactions" | "price_paid_uprn_links", syncId: string) {
  const result = await db.execute(sql`select count(*)::int as count from ${sql.identifier("reference")}.${sql.identifier(table)} where dataset_sync_id = ${syncId}`);
  return Number((result as unknown as { rows: { count: number }[] }).rows[0]?.count ?? 0);
}

async function* lines(filePath: string) {
  let number = 0;
  for await (const raw of createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })) {
    number += 1;
    const line = raw.replace(/^﻿/, "").trim();
    if (line) yield { line, number };
  }
}

function rejectionError(rejected: { line: number; reason: string }[], total: number, maxRejected: number, validation: Record<string, unknown>) {
  return Object.assign(new Error(`${total} rows were rejected (allowed ${maxRejected}). First: ${rejected.map((item) => `line ${item.line}: ${item.reason}`).join("; ")}.`), { validation });
}

export type PricePaidImportOptions = {
  filePath: string;
  datasetVersion: string;
  /** "full": a complete or yearly file. "update": a monthly change file applied to a copy of the active version. */
  mode: "full" | "update";
  /** Regional import by postcode area (for example BS, BA). Updates inherit the active version's areas. */
  postcodeAreas?: string[];
  sourceUrl?: string;
  batchSize?: number;
  /** Malformed rows tolerated before the import fails. Default 0. */
  maxRejected?: number;
  activate?: boolean;
  importedBy: string;
};

/**
 * Staged, versioned Price Paid import. Additions and changes are upserted by
 * transaction id and deletions remove the transaction, so the staged version
 * reflects HM Land Registry's corrections. The active version is untouched
 * until activation; a failed run removes its rows.
 */
export async function importPricePaid(db: Database, options: PricePaidImportOptions): Promise<ImportOutcome> {
  const active = options.mode === "update" ? await getActiveSync(db, PRICE_PAID_SOURCE) : null;
  if (options.mode === "update" && !active) throw new Error("An update file needs an active full import to apply to.");
  const inherited = active ? postcodeAreasFromExtent(active.extent) : null;
  if (options.mode === "update" && options.postcodeAreas && (inherited ?? []).join(",") !== options.postcodeAreas.join(",")) throw new Error(`Updates must use the active version's extent (${inherited ? inherited.join(",") : "full file"}).`);
  const areas = options.mode === "update" ? inherited : options.postcodeAreas ?? null;
  const sync = await createSync(db, PRICE_PAID_SOURCE, { ...options, extent: areas ? `${extentPrefix}${areas.join(",")}` : "full file" });
  return finish(db, sync, "price_paid_transactions", async () => {
    if (active) {
      await db.execute(sql`
        insert into reference.price_paid_transactions (dataset_sync_id, transaction_id, price, transfer_date, property_type, new_build, tenure, ppd_category)
        select ${sync.id}::uuid, transaction_id, price, transfer_date, property_type, new_build, tenure, ppd_category
        from reference.price_paid_transactions where dataset_sync_id = ${active.id}`);
    }
    const counts = { read: 0, added: 0, changed: 0, deleted: 0, outsideExtent: 0, rejected: 0 };
    const rejected: { line: number; reason: string }[] = [];
    // Each transaction id is in at most one pending set, so the last record in the file wins.
    const upserts = new Map<string, PricePaidRow>();
    const deletes = new Set<string>();
    const flush = async () => {
      if (deletes.size) {
        await db.execute(sql`delete from reference.price_paid_transactions where dataset_sync_id = ${sync.id} and transaction_id = any(${sql.param([...deletes])}::text[])`);
        deletes.clear();
      }
      if (upserts.size) {
        const rows = [...upserts.values()];
        await db.execute(sql`
          insert into reference.price_paid_transactions (dataset_sync_id, transaction_id, price, transfer_date, property_type, new_build, tenure, ppd_category)
          select ${sync.id}::uuid, t.id, t.price, t.transfer_date, t.property_type, t.new_build, t.tenure, t.category
          from unnest(${sql.param(rows.map((row) => row.transactionId))}::text[], ${sql.param(rows.map((row) => row.price))}::int[], ${sql.param(rows.map((row) => row.transferDate))}::date[], ${sql.param(rows.map((row) => row.propertyType))}::text[], ${sql.param(rows.map((row) => row.newBuild))}::bool[], ${sql.param(rows.map((row) => row.tenure))}::text[], ${sql.param(rows.map((row) => row.ppdCategory))}::text[])
            as t(id, price, transfer_date, property_type, new_build, tenure, category)
          on conflict (dataset_sync_id, transaction_id) do update set price = excluded.price, transfer_date = excluded.transfer_date, property_type = excluded.property_type, new_build = excluded.new_build, tenure = excluded.tenure, ppd_category = excluded.ppd_category`);
        upserts.clear();
      }
    };
    for await (const { line, number } of lines(options.filePath)) {
      counts.read += 1;
      const parsed = parsePricePaidLine(line);
      if (!parsed.ok) {
        counts.rejected += 1;
        if (rejected.length < 5) rejected.push({ line: number, reason: parsed.reason });
        continue;
      }
      if (parsed.recordStatus === "D") {
        const id = parsed.row?.transactionId ?? (parsed as { transactionId: string }).transactionId;
        upserts.delete(id);
        deletes.add(id);
        counts.deleted += 1;
      } else {
        if (areas && (!parsed.postcodeArea || !areas.includes(parsed.postcodeArea))) { counts.outsideExtent += 1; continue; }
        deletes.delete(parsed.row.transactionId);
        upserts.set(parsed.row.transactionId, parsed.row);
        if (parsed.recordStatus === "A") counts.added += 1; else counts.changed += 1;
      }
      if (upserts.size + deletes.size >= (options.batchSize ?? 5000)) await flush();
    }
    await flush();
    const stored = await countRows(db, "price_paid_transactions", sync.id);
    const validation = { mode: options.mode, basedOnSyncId: active?.id ?? null, ...counts, storedRows: stored, firstRejections: rejected };
    if (counts.rejected > (options.maxRejected ?? 0)) throw rejectionError(rejected, counts.rejected, options.maxRejected ?? 0, validation);
    if (counts.read === 0) throw Object.assign(new Error("The file is empty."), { validation });
    if (stored === 0) throw Object.assign(new Error("No transactions were stored for the requested extent."), { validation });
    return { stored, skipped: counts.rejected, validation };
  }, options.activate);
}

export type PricePaidLookupImportOptions = {
  filePath: string;
  datasetVersion: string;
  /** Header names when they cannot be detected. */
  transactionColumn?: string;
  uprnColumn?: string;
  sourceUrl?: string;
  batchSize?: number;
  maxRejected?: number;
  activate?: boolean;
  importedBy: string;
};

function lookupColumns(fields: string[], options: PricePaidLookupImportOptions) {
  const names = fields.map((field) => field.trim());
  const find = (explicit: string | undefined, pattern: RegExp) => explicit ? names.findIndex((name) => name.toLowerCase() === explicit.toLowerCase()) : names.findIndex((name) => pattern.test(name));
  const transaction = find(options.transactionColumn, /transaction/i);
  const uprn = find(options.uprnColumn, /^uprn$|uprn/i);
  if (transaction >= 0 && uprn >= 0 && transaction !== uprn) return { header: true, transaction, uprn };
  if (!options.transactionColumn && !options.uprnColumn && names.length >= 2 && normaliseTransactionId(names[0]) && normaliseUprn(names[1])) return { header: false, transaction: 0, uprn: 1 };
  throw new Error(`Could not identify the transaction id and UPRN columns in the first line (${names.length} columns). Pass --transaction-column and --uprn-column with the published header names.`);
}

/**
 * Full, versioned import of HM Land Registry's transaction-to-UPRN look-up.
 * Links are exact: nothing is inferred from addresses or coordinates, and a
 * transaction without a row here is "not linked", never "no sale".
 */
export async function importPricePaidUprnLookup(db: Database, options: PricePaidLookupImportOptions): Promise<ImportOutcome> {
  const sync = await createSync(db, PRICE_PAID_LOOKUP_SOURCE, { ...options, extent: "full file" });
  return finish(db, sync, "price_paid_uprn_links", async () => {
    const counts = { read: 0, rejected: 0 };
    const rejected: { line: number; reason: string }[] = [];
    let columns: ReturnType<typeof lookupColumns> | null = null;
    let batch: { transactionId: string; uprn: string }[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await db.execute(sql`
        insert into reference.price_paid_uprn_links (dataset_sync_id, transaction_id, uprn)
        select ${sync.id}::uuid, t.id, t.uprn from unnest(${sql.param(batch.map((row) => row.transactionId))}::text[], ${sql.param(batch.map((row) => row.uprn))}::text[]) as t(id, uprn)
        on conflict do nothing`);
      batch = [];
    };
    for await (const { line, number } of lines(options.filePath)) {
      const fields = parseCsvLine(line);
      if (!columns) {
        if (!fields) throw new Error("The first line is not valid CSV.");
        columns = lookupColumns(fields, options);
        if (columns.header) continue;
      }
      counts.read += 1;
      const transactionId = fields ? normaliseTransactionId(fields[columns.transaction] ?? "") : null;
      const uprn = fields ? normaliseUprn(fields[columns.uprn] ?? "") : null;
      if (!transactionId || !uprn) {
        counts.rejected += 1;
        if (rejected.length < 5) rejected.push({ line: number, reason: !fields ? "unterminated quote" : !transactionId ? "invalid transaction id" : "invalid UPRN" });
        continue;
      }
      batch.push({ transactionId, uprn });
      if (batch.length >= (options.batchSize ?? 10_000)) await flush();
    }
    await flush();
    const stats = await db.execute(sql`
      select count(*)::int as links, count(distinct transaction_id)::int as transactions, count(distinct uprn)::int as uprns,
        (select count(*)::int from (select transaction_id from reference.price_paid_uprn_links where dataset_sync_id = ${sync.id} group by transaction_id having count(*) > 1) multi) as multi_uprn_transactions
      from reference.price_paid_uprn_links where dataset_sync_id = ${sync.id}`);
    const row = (stats as unknown as { rows: { links: number; transactions: number; uprns: number; multi_uprn_transactions: number }[] }).rows[0];
    const validation = { ...counts, header: columns?.header ?? null, storedLinks: row.links, transactions: row.transactions, uprns: row.uprns, multiUprnTransactions: row.multi_uprn_transactions, firstRejections: rejected };
    if (counts.rejected > (options.maxRejected ?? 0)) throw rejectionError(rejected, counts.rejected, options.maxRejected ?? 0, validation);
    if (row.links === 0) throw Object.assign(new Error("No links were found in the file."), { validation });
    return { stored: row.links, skipped: counts.rejected, validation };
  }, options.activate);
}
