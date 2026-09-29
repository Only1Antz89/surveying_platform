import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function createDatabase(connectionString = process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_APP_URL or DATABASE_URL is required for database access");
  return drizzle(neon(connectionString), { schema });
}

export * from "./schema";
