import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";
import { POST } from "./route";
import { POST as provisionQueue } from "@/app/api/queues/provisioning/route";

type EventRecord = { id: string; provider: string; providerEventId: string; payloadHash: string; processedAt: Date | null; failedAt: Date | null; error: string | null };
const fixture = vi.hoisted(() => ({ event: null as EventRecord | null, failOrganisationWrite: false, organisationWrites: 0, transactions: 0 }));
vi.mock("@surveynt/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@surveynt/db")>();
  function action(work: () => unknown) {
    return { returning: async () => work(), then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(work).then(resolve, reject) };
  }
  const db = {
    insert: (table: unknown) => ({ values: (input: Record<string, unknown>) => ({ onConflictDoNothing: () => action(() => {
      if (table === actual.webhookEvents) {
        if (fixture.event) return [];
        fixture.event = { id: "event-record", provider: String(input.provider), providerEventId: String(input.providerEventId), payloadHash: String(input.payloadHash), processedAt: null, failedAt: null, error: null };
        return [{ id: fixture.event.id }];
      }
      if (fixture.failOrganisationWrite) throw new Error("Regression database failure");
      fixture.organisationWrites++;
      return [];
    }) }) }),
    select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => table === actual.webhookEvents && fixture.event ? [fixture.event] : [] }) }) }),
    update: () => ({ set: (changes: Record<string, unknown>) => ({ where: () => action(() => {
      if (!fixture.event) return [];
      Object.assign(fixture.event, changes);
      return [{ id: fixture.event.id }];
    }) }) }),
    transaction: async (work: (tx: unknown) => Promise<unknown>) => { fixture.transactions++; return work(db); },
  };
  return { ...actual, createDatabase: vi.fn(() => db) };
});
const secret = `whsec_${Buffer.from("surveynt-signature-regression-secret").toString("base64")}`;
const event = { type: "organization.created", data: { id: "org_regression", name: "Fictional test practice", slug: "test-practice" } };
function signedRequest(body: unknown = event, queue = false, id = "msg_regression") {
  const payload = JSON.stringify(body), now = new Date();
  return new Request(`http://localhost/api/${queue ? "queues/provisioning" : "webhooks/clerk"}`, { method: "POST", body: payload, headers: { "svix-id": id, "svix-timestamp": String(Math.floor(now.getTime() / 1000)), "svix-signature": new Webhook(secret).sign(id, now, payload), ...(queue ? { authorization: "Bearer regression-queue-secret" } : {}) } });
}
beforeEach(() => {
  vi.stubEnv("CLERK_WEBHOOK_SECRET", secret);
  vi.stubEnv("DATABASE_ADMIN_URL", "postgresql://example.test/fixture");
  vi.stubEnv("QUEUE_CONSUMER_SECRET", "regression-queue-secret");
  fixture.event = null; fixture.failOrganisationWrite = false; fixture.organisationWrites = 0; fixture.transactions = 0;
});
afterAll(() => vi.unstubAllEnvs());

describe("Clerk account provisioning and retries", () => {
  it("verifies an actual Svix signature and processes changes in a transaction", async () => {
    expect((await POST(signedRequest())).status).toBe(200);
    expect(fixture.transactions).toBe(1);
    expect(fixture.organisationWrites).toBe(1);
    expect(fixture.event?.processedAt).toBeInstanceOf(Date);
  });
  it("retries a failed delivery rather than dropping it as a duplicate", async () => {
    fixture.failOrganisationWrite = true;
    expect((await POST(signedRequest())).status).toBe(500);
    expect(fixture.event?.failedAt).toBeInstanceOf(Date);
    expect(fixture.event?.processedAt).toBeNull();
    fixture.failOrganisationWrite = false;
    expect((await POST(signedRequest())).status).toBe(200);
    expect(fixture.event?.failedAt).toBeNull();
    expect(fixture.event?.processedAt).toBeInstanceOf(Date);
    expect(fixture.organisationWrites).toBe(1);
    expect((await (await POST(signedRequest())).json()).duplicate).toBe(true);
    expect(fixture.organisationWrites).toBe(1);
  });
  it("rejects a different signed payload that reuses the same event identity", async () => {
    await POST(signedRequest());
    expect((await POST(signedRequest({ ...event, data: { ...event.data, name: "Changed payload" } }))).status).toBe(409);
    expect(fixture.organisationWrites).toBe(1);
  });
  it("leaves out-of-order membership delivery retryable until its organisation exists", async () => {
    const membership = { type: "organizationMembership.created", data: { role: "org:member", organization: { id: "org_not_synced" }, public_user_data: { user_id: "user_fixture", identifier: "fixture@example.test" } } };
    expect((await POST(signedRequest(membership))).status).toBe(500);
    expect(fixture.event?.processedAt).toBeNull();
    expect(fixture.event?.failedAt).toBeInstanceOf(Date);
  });
  it("rejects invalid signatures before any database operations", async () => {
    expect((await POST(new Request("http://localhost/api/webhooks/clerk", { method: "POST", body: JSON.stringify(event) }))).status).toBe(400);
    expect(fixture.event).toBeNull();
    expect(fixture.transactions).toBe(0);
  });
  it("makes provisioning queue deliveries perform verified provisioning", async () => {
    expect((await provisionQueue(signedRequest(event, true))).status).toBe(200);
    expect(fixture.organisationWrites).toBe(1);
    expect(fixture.event?.processedAt).toBeInstanceOf(Date);
  });
  it("rejects unsigned or unauthorized queue payloads instead of acknowledging them", async () => {
    expect((await provisionQueue(signedRequest(event))).status).toBe(401);
    expect((await provisionQueue(new Request("http://localhost/api/queues/provisioning", { method: "POST", headers: { authorization: "Bearer regression-queue-secret" }, body: "{}" }))).status).toBe(400);
    expect(fixture.organisationWrites).toBe(0);
  });
});
