import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export function createDatabase(connectionString = process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_APP_URL or DATABASE_URL is required for database access");
  // Tenant repositories set their RLS context inside an interactive transaction.
  // The Neon HTTP driver cannot run those transactions, so use the pooled
  // serverless driver for both local and Vercel runtimes.
  const pool = new Pool({ connectionString });
  // Idle clients can be closed by the server (scale-to-zero, failover). Without a
  // listener the pool's "error" event would crash the process.
  pool.on("error", (error: Error) => console.error("Database pool connection closed:", error.message));
  return drizzle({ client: pool, schema });
}

export type Database = ReturnType<typeof createDatabase>;
export type TenantTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Runs work in a transaction whose row-level security context is the given organisation. */
export async function withTenant<T>(db: Database, organisationId: string, work: (tx: TenantTransaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisationId}, true)`);
    return work(tx);
  });
}

export * from "./schema";
