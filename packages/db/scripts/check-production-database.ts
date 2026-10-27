// Read-only production database check. Compares the applied migration ledger
// with the repository journal and reports storage use, so an operator can see
// what is missing before running db:migrate. It never writes: every query runs
// inside a READ ONLY transaction that is rolled back.
//
//   DATABASE_ADMIN_URL=... pnpm --filter @surveynt/db check:production
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations/generated");
// Neon's free and launch-tier project storage limit observed in the 2 October capacity report.
const storageLimitBytes = Number(process.env.DATABASE_STORAGE_LIMIT_BYTES ?? 1024 * 1024 * 1024);

type JournalEntry = { idx: number; tag: string; when: number };

export async function expectedMigrations() {
  const journal = JSON.parse(await readFile(path.join(migrationsDirectory, "meta/_journal.json"), "utf8")) as { entries: JournalEntry[] };
  return Promise.all(journal.entries.map(async (entry) => {
    const body = await readFile(path.join(migrationsDirectory, `${entry.tag}.sql`), "utf8");
    return { tag: entry.tag, when: entry.when, hash: createHash("sha256").update(body).digest("hex") };
  }));
}

export function compareLedger(expected: { tag: string; when: number; hash: string }[], applied: { hash: string; created_at: string | number }[]) {
  const appliedByHash = new Map(applied.map((row) => [row.hash, Number(row.created_at)]));
  const missing = expected.filter((entry) => !appliedByHash.has(entry.hash));
  const timestampMismatch = expected.filter((entry) => appliedByHash.has(entry.hash) && appliedByHash.get(entry.hash) !== entry.when).map((entry) => entry.tag);
  const known = new Set(expected.map((entry) => entry.hash));
  const unknownApplied = applied.filter((row) => !known.has(row.hash)).length;
  const lastApplied = [...expected].reverse().find((entry) => appliedByHash.has(entry.hash))?.tag ?? null;
  return { expected: expected.length, applied: applied.length, lastApplied, missing: missing.map((entry) => entry.tag), timestampMismatch, unknownApplied };
}

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is required.");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("begin transaction read only");
    await client.query("set local statement_timeout = '30s'");
    const ledgerExists = (await client.query("select to_regclass('drizzle.__drizzle_migrations') is not null as present")).rows[0]?.present === true;
    const applied = ledgerExists ? (await client.query("select hash, created_at from drizzle.__drizzle_migrations order by created_at")).rows as { hash: string; created_at: string }[] : [];
    const ledger = compareLedger(await expectedMigrations(), applied);
    const database = (await client.query("select pg_database_size(current_database())::bigint as bytes")).rows[0] as { bytes: string };
    const tables = (await client.query(`
      select n.nspname || '.' || c.relname as "table", pg_total_relation_size(c.oid)::bigint as total_bytes,
        pg_indexes_size(c.oid)::bigint as index_bytes, coalesce(s.n_live_tup, 0)::bigint as live_rows, coalesce(s.n_dead_tup, 0)::bigint as dead_rows,
        s.last_autovacuum, s.last_vacuum
      from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_user_tables s on s.relid = c.oid
      where c.relkind = 'r' and n.nspname in ('public', 'reference')
      order by pg_total_relation_size(c.oid) desc limit 15`)).rows;
    const activeReference = (await client.query(`
      select source_key, layer, dataset_version, record_count, activated_at from reference.dataset_syncs where status = 'active'
      union all select source_key, 'legacy', version, record_count, updated_at from public.dataset_versions where active
      order by 1, 2`).catch(() => ({ rows: [] }))).rows;
    const usedBytes = Number(database.bytes);
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      migrations: { ...ledger, upToDate: ledger.missing.length === 0 && ledger.timestampMismatch.length === 0 && ledger.unknownApplied === 0 },
      storage: { databaseBytes: usedBytes, limitBytes: storageLimitBytes, percentUsed: Math.round((usedBytes / storageLimitBytes) * 1000) / 10 },
      largestTables: tables,
      activeReferenceData: activeReference,
    }, null, 2));
    if (ledger.missing.length) process.exitCode = 2;
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
