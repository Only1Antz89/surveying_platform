import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export function createDatabase(connectionString = process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_APP_URL or DATABASE_URL is required for database access");
  // Tenant repositories set their RLS context inside an interactive transaction.
  // The Neon HTTP driver cannot run those transactions, so use the pooled
  // serverless driver for both local and Vercel runtimes.
  return drizzle({ client: new Pool({ connectionString }), schema });
}

export * from "./schema";
