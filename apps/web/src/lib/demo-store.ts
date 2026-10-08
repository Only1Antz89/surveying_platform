import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clients, tenants, type Client, type Tenant } from "./demo-data";

export type DemoClient = { id: string; organisationId: string; kind: "individual" | "company"; displayName: string; email: string | null; phone: string | null; version: number; archivedAt: string | null; properties: number; updatedAt: string };
export type DemoContact = { id: string; clientId: string; name: string; email: string | null; phone: string | null; preferredChannel: "email" | "phone" | "sms" | "post"; primary: boolean };
export type DemoSession = { id: string; organisationId: string; platformStaffId: string; ticketReference: string; reason: string; permission: "read" | "write"; requestedAt: string; expiresAt: string; breakGlass: boolean; approvedByUserId: string | null; revokedAt: string | null };
export type DemoAudit = { id: string; organisationId: string; action: string; resourceType: string; resourceId: string; occurredAt: string; actor: string; metadata: Record<string, unknown> };
export type DemoState = { schema: 1; tenants: Tenant[]; clients: DemoClient[]; contacts: DemoContact[]; sessions: DemoSession[]; audit: DemoAudit[] };

function initialState(): DemoState {
  const now = new Date().toISOString();
  const records = tenants.flatMap(tenant => clients.map(client => ({ id: client.id, organisationId: tenant.id, kind: client.kind === "Company" ? "company" as const : "individual" as const, displayName: client.name, email: client.email, phone: client.phone, version: 1, archivedAt: null, properties: client.properties, updatedAt: now })));
  return { schema: 1, tenants: tenants.map((tenant, index) => ({ ...tenant, slug: index === 0 ? "demo" : `demo-${tenant.id}`, isDemo: true })), clients: records, contacts: records.map(client => ({ id: `contact-${client.id}`, clientId: `${client.organisationId}:${client.id}`, name: client.displayName, email: client.email, phone: client.phone, preferredChannel: "email", primary: true })), sessions: [], audit: [] };
}

/** Local preview only. Signed-in practices continue to use PostgreSQL and Clerk. */
export function createDemoStore(path: string) {
  async function snapshot(): Promise<DemoState> {
    try {
      const state: DemoState = JSON.parse(await readFile(path, "utf8"));
      if (state.schema !== 1) throw new Error("Unsupported local demo data version.");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialState();
      throw error;
    }
  }
  async function mutate<T>(work: (state: DemoState) => T | Promise<T>): Promise<T> {
    await mkdir(dirname(path), { recursive: true });
    // Serialize writes across Next workers as well as concurrent requests.
    let lock;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { lock = await open(`${path}.lock`, "wx", 0o600); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!lock) throw new Error("Local demo data is busy. Please retry.");
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const state = await snapshot();
      const result = await work(state);
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, path);
      return result;
    } finally {
      await unlink(temporary).catch(() => undefined);
      await lock.close();
      await unlink(`${path}.lock`);
    }
  }
  return { snapshot, mutate };
}
const workspace = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
export const demoStore = createDemoStore(join(tmpdir(), "surveynt-local-preview", workspace, "state.json"));
export function demoTenant(state: DemoState, slug = "demo") {
  const canonical = ["clifton-surveyors", "north-star-surveying"].includes(slug) ? "demo" : slug;
  return state.tenants.find(tenant => tenant.slug === canonical);
}
export function demoClients(state: DemoState, organisationId: string): Client[] {
  return state.clients.filter(client => client.organisationId === organisationId && !client.archivedAt).map(client => ({ id: client.id, name: client.displayName, kind: client.kind === "company" ? "Company" : "Individual", email: client.email ?? "—", phone: client.phone ?? "—", version: client.version, properties: client.properties, lastActivity: new Date(client.updatedAt).toLocaleDateString("en-GB") }));
}
export function recordDemoAudit(state: DemoState, organisationId: string, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}, actor = "Demo operator") {
  state.audit.push({ id: randomUUID(), organisationId, action, resourceType, resourceId, metadata, actor, occurredAt: new Date().toISOString() });
}
export function demoSessionActive(session: DemoSession, staffId: string, method = "GET", now = new Date()) {
  return session.platformStaffId === staffId && !session.revokedAt && new Date(session.expiresAt) > now && (session.permission === "read" ? method === "GET" : Boolean(session.approvedByUserId || session.breakGlass));
}
