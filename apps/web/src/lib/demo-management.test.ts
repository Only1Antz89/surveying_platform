import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { demoStore, createDemoStore } from "./demo-store";
import { GET as listClients, POST as createClient } from "@/app/api/v1/clients/route";
import { GET as getClient, PATCH as updateClient } from "@/app/api/v1/clients/[id]/route";
import { POST as addContact } from "@/app/api/v1/clients/[id]/contacts/route";
import { PATCH as updateContact, DELETE as deleteContact } from "@/app/api/v1/clients/[id]/contacts/[contactId]/route";
import { PATCH as changeStatus } from "@/app/api/platform/tenants/[tenantId]/status/route";
import { POST as requestSupport } from "@/app/api/platform/tenants/[tenantId]/support-sessions/route";
import { PATCH as approveSupport } from "@/app/api/v1/support-sessions/[id]/route";
import { loadClients, loadTenants, loadTenantDetail, loadPlatformSupportQueue, loadSupportSessionView } from "./data";

const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("./demo-store", async importOriginal => {
  const actual = await importOriginal<typeof import("./demo-store")>();
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  fixture.directory = await mkdtemp(`${tmpdir()}/surveynt-review-test-`);
  return { ...actual, demoStore: actual.createDemoStore(`${fixture.directory}/state.json`) };
});

const request = (path: string, method = "GET", body?: unknown, slug = "demo") => new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", "x-demo-organisation-slug": slug }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const route = (id: string) => ({ params: Promise.resolve({ id }) });
const tenantRoute = (tenantId = "org_01") => ({ params: Promise.resolve({ tenantId }) });
beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("CLERK_SECRET_KEY", "");
  const initial = await createDemoStore(`${fixture.directory}/unused-seed.json`).snapshot();
  await demoStore.mutate(state => Object.assign(state, initial));
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(fixture.directory, { recursive: true, force: true }); });

describe("platform and client demo management", () => {
  it("persists create/edit/archive through API and page loaders and rejects stale edits", async () => {
    const created = await (await createClient(request("/api/v1/clients", "POST", { kind: "company", displayName: "Demo regression firm" }))).json();
    const id = created.data.id;
    expect(created.data.version).toBe(1);
    expect((await loadClients("demo")).some(client => client.id === id)).toBe(true);
    const updated = await updateClient(request(`/api/v1/clients/${id}`, "PATCH", { displayName: "Changed demo firm", version: 1 }), route(id));
    expect(updated.status).toBe(200);
    expect((await (await getClient(request(`/api/v1/clients/${id}`), route(id))).json()).data.client.displayName).toBe("Changed demo firm");
    expect((await updateClient(request(`/api/v1/clients/${id}`, "PATCH", { phone: "07700 900123", version: 1 }), route(id))).status).toBe(409);
    expect((await updateClient(request(`/api/v1/clients/${id}`, "PATCH", { archived: true, version: 2 }), route(id))).status).toBe(200);
    expect((await loadClients("demo")).some(client => client.id === id)).toBe(false);
    expect((await (await listClients(request("/api/v1/clients"))).json()).data.some((client: { id: string }) => client.id === id)).toBe(false);
    expect((await loadTenantDetail("org_01"))?.audit.map(event => event.action)).toContain("client.archived");
  });

  it("keeps tenants separate and makes suspension affect the workspace and API", async () => {
    const body = { status: "suspended", reason: "Suspending fictional demo for regression" };
    expect((await changeStatus(request("/api/platform/tenants/org_01/status", "PATCH", body), tenantRoute())).status).toBe(200);
    expect((await loadTenants()).find(tenant => tenant.id === "org_01")?.status).toBe("suspended");
    expect((await listClients(request("/api/v1/clients"))).status).toBe(403);
    expect((await listClients(request("/api/v1/clients", "GET", undefined, "demo-org_02"))).status).toBe(200);
    expect((await changeStatus(request("/api/platform/tenants/org_01/status", "PATCH", { ...body, status: "active" }), tenantRoute())).status).toBe(200);
    expect((await listClients(request("/api/v1/clients"))).status).toBe(200);
    const id = (await (await createClient(request("/api/v1/clients", "POST", { kind: "individual", displayName: "Private demo client" }))).json()).data.id;
    expect((await getClient(request(`/api/v1/clients/${id}`, "GET", undefined, "demo-org_02"), route(id))).status).toBe(404);
    expect((await changeStatus(request("/api/platform/tenants/missing/status", "PATCH", body), tenantRoute("missing"))).status).toBe(404);
    expect((await changeStatus(request("/api/platform/tenants/org_03/status", "PATCH", { ...body, status: "active" }), tenantRoute("org_03"))).status).toBe(409);
  });

  it("persists contacts, maintains one primary contact, and rejects missing contacts", async () => {
    const path = "/api/v1/clients/cli_01/contacts";
    const response = await addContact(request(path, "POST", { name: "Second contact", primary: true }), route("cli_01"));
    const contact = (await response.json()).data;
    let detail = (await (await getClient(request("/api/v1/clients/cli_01"), route("cli_01"))).json()).data;
    expect(detail.contacts.filter((item: { primary: boolean }) => item.primary)).toHaveLength(1);
    const contactRoute = { params: Promise.resolve({ id: "cli_01", contactId: contact.id }) };
    expect((await updateContact(request(`${path}/${contact.id}`, "PATCH", { preferredChannel: "phone" }), contactRoute)).status).toBe(200);
    detail = (await (await getClient(request("/api/v1/clients/cli_01"), route("cli_01"))).json()).data;
    expect(detail.contacts.find((item: { id: string }) => item.id === contact.id).preferredChannel).toBe("phone");
    expect((await deleteContact(request(`${path}/${contact.id}`, "DELETE"), contactRoute)).status).toBe(200);
    expect((await deleteContact(request(`${path}/${contact.id}`, "DELETE"), contactRoute)).status).toBe(404);
    expect((await addContact(request("/api/v1/clients/missing/contacts", "POST", { name: "Missing parent" }), route("missing"))).status).toBe(404);
  });

  it("enables platform edits only through an approved active write session", async () => {
    const response = await requestSupport(request("/api/platform/tenants/org_01/support-sessions", "POST", { ticketReference: "TEST-123", reason: "Fictional client management regression", permission: "write" }), tenantRoute());
    const session = (await response.json()).data;
    const path = `/api/platform/support/${session.id}/clients/cli_01`;
    expect(await loadSupportSessionView(session.id)).toBeNull();
    expect((await updateClient(request(path, "PATCH", { displayName: "Changed by support", version: 1 }), route("cli_01"))).status).toBe(401);
    expect((await approveSupport(request(`/api/v1/support-sessions/${session.id}`, "PATCH", { decision: "approve" }), route(session.id))).status).toBe(200);
    expect((await loadPlatformSupportQueue()).find(item => item.id === session.id)?.href).toBe(`/platform/support/${session.id}`);
    expect((await updateClient(request(path, "PATCH", { displayName: "Changed by support", version: 1 }), route("cli_01"))).status).toBe(200);
    expect((await loadClients("demo")).find(client => client.id === "cli_01")?.name).toBe("Changed by support");
    expect((await loadClients("demo-org_02")).find(client => client.id === "cli_01")?.name).toBe("Elizabeth Harrington");
    await demoStore.mutate(state => { state.sessions.find(item => item.id === session.id)!.expiresAt = new Date(0).toISOString(); });
    expect((await getClient(request(path), route("cli_01"))).status).toBe(401);
    expect(await loadSupportSessionView(session.id)).toBeNull();
  });

  it("keeps read sessions read only and denies revoked sessions", async () => {
    const session = (await (await requestSupport(request("/api/platform/tenants/org_01/support-sessions", "POST", { ticketReference: "TEST-READ", reason: "Fictional read-only support regression" }), tenantRoute())).json()).data;
    const path = `/api/platform/support/${session.id}/clients/cli_01`;
    expect((await getClient(request(path), route("cli_01"))).status).toBe(200);
    expect((await updateClient(request(path, "PATCH", { archived: true, version: 1 }), route("cli_01"))).status).toBe(401);
    await demoStore.mutate(state => { state.sessions.find(item => item.id === session.id)!.revokedAt = new Date().toISOString(); });
    expect((await getClient(request(path), route("cli_01"))).status).toBe(401);
  });

  it("returns validation errors for malformed JSON without pretending a change succeeded", async () => {
    const response = await createClient(new Request("http://localhost/api/v1/clients", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect((await loadClients("demo"))).toHaveLength(5);
  });

  it("serializes concurrent edits so only one edit of a version succeeds", async () => {
    const responses = await Promise.all(["First concurrent name", "Second concurrent name"].map(displayName => updateClient(request("/api/v1/clients/cli_01", "PATCH", { displayName, version: 1 }), route("cli_01"))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await demoStore.snapshot()).clients.find(client => client.id === "cli_01" && client.organisationId === "org_01")?.version).toBe(2);
  });
});
