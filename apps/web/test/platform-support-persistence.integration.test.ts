import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, clientContacts, clients, entitlements, organisationMemberships, organisations, platformStaff, supportSessions, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
// Only the Clerk session lookup is replaced; access resolution, RLS and audit run for real.
const session = vi.hoisted(() => ({ userId: null as string | null, orgId: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId, orgId: session.orgId }) }));
vi.mock("server-only", () => ({}));
import { PATCH as changeStatus } from "../src/app/api/platform/tenants/[tenantId]/status/route";
import { POST as requestSupport } from "../src/app/api/platform/tenants/[tenantId]/support-sessions/route";
import { PATCH as decideSupport } from "../src/app/api/v1/support-sessions/[id]/route";
import { GET as supportList, POST as supportCreate } from "../src/app/api/platform/support/[sessionId]/clients/route";
import { PATCH as supportPatch } from "../src/app/api/platform/support/[sessionId]/clients/[id]/route";
import { POST as supportContact } from "../src/app/api/platform/support/[sessionId]/clients/[id]/contacts/route";
import { GET as practiceList } from "../src/app/api/v1/clients/route";
import { GET as practiceRead, PATCH as practicePatch } from "../src/app/api/v1/clients/[id]/route";

const origin = "https://surveynt.test";
const json = (method: string, path: string, body?: unknown) => new Request(origin + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const as = (userId: string, orgId: string | null = null) => { session.userId = userId; session.orgId = orgId; };
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never;

describe.skipIf(!integrationEnabled)("platform management persists into the practice's own records (PostgreSQL)", () => {
  let database: TestDatabase, db: Database;
  let practice: typeof organisations.$inferSelect, other: typeof organisations.$inferSelect, owner: typeof users.$inferSelect;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl); vi.stubEnv("DATABASE_APP_URL", database.appUrl);
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fictional"); vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fictional");
    [practice, other] = await db.insert(organisations).values([
      { clerkOrganisationId: "org_support_demo", slug: "support-demo", name: "Support demo practice", practiceType: "building_surveying", region: "Bristol", status: "active", isDemo: true, demoGeneration: 1 },
      { clerkOrganisationId: "org_support_other", slug: "support-other", name: "Other practice", practiceType: "building_surveying", region: "Bath", status: "active" },
    ]).returning();
    [owner] = await db.insert(users).values({ clerkUserId: "user_support_owner", email: "owner@support.test" }).returning();
    await db.insert(organisationMemberships).values({ organisationId: practice.id, userId: owner.id, role: "owner", active: true });
    await db.insert(entitlements).values({ organisationId: practice.id, key: "billing_exempt", enabled: true });
    await db.insert(platformStaff).values([
      { clerkUserId: "user_support_admin", role: "super_admin", active: true },
      { clerkUserId: "user_support_agent", role: "support", active: true },
      { clerkUserId: "user_support_other_agent", role: "support", active: true },
    ]);
  });
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("applies lifecycle, approved support writes and practice edits to the same records", async () => {
    // Lifecycle: suspension blocks the practice, reactivation restores it.
    as("user_support_admin");
    expect((await changeStatus(json("PATCH", `/api/platform/tenants/${practice.id}/status`, { status: "suspended", reason: "Acceptance check suspension." }), params({ tenantId: practice.id }))).status).toBe(200);
    as("user_support_owner", "org_support_demo");
    expect((await practiceList(json("GET", "/api/v1/clients"))).status).toBe(401);
    as("user_support_admin");
    expect((await changeStatus(json("PATCH", `/api/platform/tenants/${practice.id}/status`, { status: "active", reason: "Acceptance check reactivation." }), params({ tenantId: practice.id }))).status).toBe(200);
    expect((await db.select().from(organisations).where(eq(organisations.id, practice.id)))[0].status).toBe("active");
    as("user_support_owner", "org_support_demo");
    expect((await practiceList(json("GET", "/api/v1/clients"))).status).toBe(200);
    as("user_support_agent");
    expect((await changeStatus(json("PATCH", `/api/platform/tenants/${practice.id}/status`, { status: "suspended", reason: "Support role must not suspend." }), params({ tenantId: practice.id }))).status).toBe(403);

    // Write support access waits for the owner.
    const requested = await requestSupport(json("POST", `/api/platform/tenants/${practice.id}/support-sessions`, { ticketReference: "ACC-1", reason: "Acceptance check write session.", permission: "write" }), params({ tenantId: practice.id }));
    expect(requested.status).toBe(200);
    const sessionId = (await requested.json()).data.id as string;
    const base = `/api/platform/support/${sessionId}/clients`;
    expect((await supportCreate(json("POST", base, { kind: "individual", displayName: "Before approval" }))).status).toBe(401);
    as("user_support_owner", "org_support_demo");
    expect((await decideSupport(json("PATCH", `/api/v1/support-sessions/${sessionId}`, { decision: "approve" }), params({ id: sessionId }))).status).toBe(200);
    expect((await db.select().from(supportSessions).where(eq(supportSessions.id, sessionId)))[0].approvedByUserId).toBe(owner.id);

    // Support writes land in the practice's tenant records.
    as("user_support_agent");
    const created = await supportCreate(json("POST", base, { kind: "company", displayName: "Support Created Ltd", email: "created@example.test" }));
    expect([200, 201]).toContain(created.status);
    const client = (await created.json()).data as { id: string; version: number };
    const patched = await supportPatch(json("PATCH", `${base}/${client.id}`, { phone: "0117 000 0000", version: client.version }), params({ sessionId, id: client.id }));
    expect(patched.status).toBe(200);
    expect((await supportContact(json("POST", `${base}/${client.id}/contacts`, { name: "Support Contact", email: "contact@example.test", primary: true }), params({ sessionId, id: client.id }))).status).toBeLessThan(300);
    expect((await db.select().from(clients).where(eq(clients.id, client.id)))[0]).toMatchObject({ organisationId: practice.id, phone: "0117 000 0000", version: 2 });

    // The owner's own session sees the same record, then edits it.
    as("user_support_owner", "org_support_demo");
    const listed = (await (await practiceList(json("GET", "/api/v1/clients"))).json()).data as { id: string }[];
    expect(listed.map(row => row.id)).toContain(client.id);
    const read = (await (await practiceRead(json("GET", `/api/v1/clients/${client.id}`), params({ id: client.id }))).json()).data;
    expect(JSON.stringify(read)).toContain("Support Contact");
    expect((await practicePatch(json("PATCH", `/api/v1/clients/${client.id}`, { displayName: "Practice Renamed Ltd", version: 2 }), params({ id: client.id }))).status).toBe(200);

    // A stale support write is a conflict; the newer practice edit stays.
    as("user_support_agent");
    expect((await supportPatch(json("PATCH", `${base}/${client.id}`, { displayName: "Stale support name", version: 2 }), params({ sessionId, id: client.id }))).status).toBe(409);
    const supportView = (await (await supportList(json("GET", base))).json()).data as { id: string; displayName: string }[];
    expect(supportView.find(row => row.id === client.id)?.displayName).toBe("Practice Renamed Ltd");

    // Attribution: support writes record the operator and session; no other tenant is touched.
    const events = await db.select().from(auditEvents).where(and(eq(auditEvents.organisationId, practice.id), eq(auditEvents.resourceId, client.id)));
    const supportEvents = events.filter(event => event.supportSessionId === sessionId);
    expect(supportEvents.length).toBeGreaterThanOrEqual(2);
    expect(supportEvents.every(event => typeof event.platformStaffId === "string" && event.actorUserId === null)).toBe(true);
    expect(await db.select().from(clients).where(eq(clients.organisationId, other.id))).toHaveLength(0);
    expect((await db.select().from(clientContacts).where(eq(clientContacts.clientId, client.id)))[0]).toMatchObject({ organisationId: practice.id, primary: true });

    // The session is bound to its operator, its tenant and its permission.
    as("user_support_other_agent");
    expect((await supportList(json("GET", base))).status).toBe(401);
    as("user_support_agent");
    const readOnly = await requestSupport(json("POST", `/api/platform/tenants/${practice.id}/support-sessions`, { ticketReference: "ACC-2", reason: "Acceptance check read session." }), params({ tenantId: practice.id }));
    const readId = (await readOnly.json()).data.id as string;
    expect((await supportList(json("GET", `/api/platform/support/${readId}/clients`))).status).toBe(200);
    expect((await supportCreate(json("POST", `/api/platform/support/${readId}/clients`, { kind: "individual", displayName: "Read only write" }))).status).toBe(401);
    await db.update(supportSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(supportSessions.id, sessionId));
    expect((await supportCreate(json("POST", base, { kind: "individual", displayName: "After expiry" }))).status).toBe(401);
  });
});
