import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/index";

async function main() {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  if (!values.output) throw new Error("--output is required.");
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [legacy, canonical, sources, migrations] = await Promise.all([
    db.execute(sql`select id, source_key, version, checksum, source_url, record_count, validation, activated_at from public.dataset_versions where active = true order by source_key, version`),
    db.execute(sql`select id, source_key, layer, dataset_version, checksum, record_count, validation, previous_active_id, activated_at from reference.dataset_syncs where status = 'active' order by source_key, layer`),
    db.execute(sql`select key, enabled, verified_at, verified_by, verification_notes, last_success_at from reference.data_sources order by key`),
    db.execute(sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at`),
  ]);
  const backup = { capturedAt: new Date().toISOString(), legacyActiveVersions: legacy.rows, canonicalActiveVersions: canonical.rows, sourceDecisions: sources.rows, migrations: migrations.rows };
  await writeFile(values.output, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output: values.output, legacyActiveVersions: legacy.rows.length, canonicalActiveVersions: canonical.rows.length, sources: sources.rows.length, migrations: migrations.rows.length }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
