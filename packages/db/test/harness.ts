// Integration-test harness. It runs the production Neon serverless driver
// against a plain local PostgreSQL + PostGIS server through a minimal
// WebSocket-to-TCP relay, so RLS, grants and spatial SQL are exercised exactly
// as deployed code issues them. Never import this from application code.
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { WebSocket, WebSocketServer } from "ws";
import { createDatabase } from "../src/index";

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations/generated");

export const integrationDatabaseUrl = process.env.TEST_DATABASE_URL;
export const integrationEnabled = Boolean(integrationDatabaseUrl);

let relay: { port: number; server: WebSocketServer } | null = null;

async function startRelay() {
  if (relay) return relay;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket, request) => {
    const address = new URL(request.url ?? "/", "http://relay").searchParams.get("address") ?? "";
    const [host, port] = address.split(":");
    if (host !== "127.0.0.1" && host !== "localhost") return socket.close(1008, "Local databases only");
    const upstream = net.connect(Number(port), host);
    upstream.on("data", (chunk) => socket.readyState === WebSocket.OPEN && socket.send(chunk));
    upstream.on("close", () => socket.close());
    upstream.on("error", () => socket.close());
    socket.on("message", (chunk) => upstream.write(chunk as Buffer));
    socket.on("close", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  neonConfig.webSocketConstructor = WebSocket;
  neonConfig.wsProxy = (host, upstreamPort) => `127.0.0.1:${port}/v1?address=${host}:${upstreamPort}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  relay = { port, server };
  return relay;
}

export async function stopRelay() {
  if (!relay) return;
  await new Promise<void>((resolve) => relay!.server.close(() => resolve()));
  relay = null;
}

function withDatabase(url: string, database: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function withCredentials(url: string, user: string, password: string) {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

export async function applyMigrations(url: string) {
  const journal = JSON.parse(await readFile(path.join(migrationsDirectory, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const pool = new Pool({ connectionString: url });
  try {
    for (const entry of journal.entries) {
      const source = await readFile(path.join(migrationsDirectory, `${entry.tag}.sql`), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) {
        if (statement.trim()) await pool.query(statement);
      }
    }
  } finally {
    await pool.end();
  }
}

export type TestDatabase = {
  /** Owner connection, equivalent to DATABASE_ADMIN_URL. */
  adminUrl: string;
  /** Tenant runtime connection without BYPASSRLS, equivalent to DATABASE_APP_URL. */
  appUrl: string;
  /** Reference-data importer connection, equivalent to DATABASE_IMPORTER_URL. */
  importerUrl: string;
  name: string;
  /** Opens a tracked Drizzle connection that is closed before the database is dropped. */
  connect(url: string): ReturnType<typeof createDatabase>;
  drop(): Promise<void>;
};

/**
 * Creates an isolated database, applies every journaled migration as the owner
 * and provisions login roles the way docs/property-intelligence/configuration.md
 * instructs operators to.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!integrationDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for integration tests");
  await startRelay();
  const name = `surveynt_it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const server = new Pool({ connectionString: integrationDatabaseUrl });
  await server.query(`create database ${name}`);
  await server.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'surveynt_it_app') then create role surveynt_it_app login password 'app' nobypassrls nosuperuser; end if;
    if not exists (select 1 from pg_roles where rolname = 'surveynt_it_importer') then create role surveynt_it_importer login password 'importer' nobypassrls nosuperuser; end if;
  end $$`);
  await server.end();
  const adminUrl = withDatabase(integrationDatabaseUrl, name);
  await applyMigrations(adminUrl);
  const admin = new Pool({ connectionString: adminUrl });
  // Mirrors the operator grants documented for Neon roles.
  await admin.query(`grant usage on schema public to surveynt_it_app;
    grant select, insert, update, delete on all tables in schema public to surveynt_it_app;
    do $$ begin
      if exists (select 1 from pg_roles where rolname = 'surveynt_reference_read') then execute 'grant surveynt_reference_read to surveynt_it_app'; end if;
      if exists (select 1 from pg_roles where rolname = 'surveynt_reference_write') then execute 'grant surveynt_reference_write to surveynt_it_importer'; end if;
    end $$;`);
  await admin.end();
  const opened: ReturnType<typeof createDatabase>[] = [];
  return {
    name,
    connect(url: string) {
      const db = createDatabase(url);
      opened.push(db);
      return db;
    },
    adminUrl,
    appUrl: withCredentials(adminUrl, "surveynt_it_app", "app"),
    importerUrl: withCredentials(adminUrl, "surveynt_it_importer", "importer"),
    async drop() {
      await Promise.all(opened.map((db) => db.$client.end().catch(() => undefined)));
      const cleanup = new Pool({ connectionString: integrationDatabaseUrl });
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}
