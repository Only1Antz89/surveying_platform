import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformRole } from "@surveynt/domain";
import { clientApiContext, clientAuditActor, clientDatabase } from "./client-api-context";
import { createDatabase } from "@surveynt/db";

const fixture = vi.hoisted(() => ({
  operator: { userId: "operator", platformStaffId: "staff", role: "support" as PlatformRole, demo: false },
  authenticated: true,
  session: { organisationId: "tenant", platformStaffId: "staff", permission: "write", approvedByUserId: "owner", revokedAt: null as Date | null, expiresAt: new Date(Date.now() + 60000), breakGlass: false },
}));
vi.mock("./access", () => ({
  apiContext: vi.fn(async () => ({ userId: "firm-member", organisationId: "own-tenant", role: "owner", demo: false })),
  platformApiContext: vi.fn(async () => fixture.authenticated ? fixture.operator : null),
}));
vi.mock("@surveynt/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@surveynt/db")>();
  return { ...actual, createDatabase: vi.fn(() => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [fixture.session] }) }) }) })) };
});
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const request = (method = "GET") => new Request(`http://localhost/api/platform/support/${id}/clients`, { method });
beforeEach(() => {
  fixture.authenticated = true;
  fixture.operator.role = "support";
  Object.assign(fixture.session, { permission: "write", approvedByUserId: "owner", revokedAt: null, expiresAt: new Date(Date.now() + 60000), breakGlass: false });
  vi.clearAllMocks();
});
describe("production support permissions", () => {
  it("derives tenant and audit actor from the authorized support session", async () => {
    const context = await clientApiContext(request("POST"));
    expect(context).toMatchObject({ organisationId: "tenant", role: "administrator", accessLevel: "full", supportSessionId: id, platformStaffId: "staff", internalUserId: null });
    expect(clientAuditActor(context!)).toEqual({ actorUserId: null, platformStaffId: "staff", supportSessionId: id });
    clientDatabase(context!);
    expect(createDatabase).toHaveBeenCalledWith(process.env.DATABASE_ADMIN_URL);
  });
  it("uses ordinary membership for workspace URLs, never a support header", async () => {
    expect(await clientApiContext(new Request("http://localhost/api/v1/clients", { headers: { "x-support-session": id } }))).toMatchObject({ userId: "firm-member", organisationId: "own-tenant" });
    expect(createDatabase).not.toHaveBeenCalled();
  });
  it.each(["billing", "compliance"] as const)("denies the %s platform role", async role => {
    fixture.operator.role = role;
    expect(await clientApiContext(request())).toBeNull();
    expect(createDatabase).not.toHaveBeenCalled();
  });
  it("denies missing authentication, expired, revoked and pending approval sessions", async () => {
    fixture.authenticated = false;
    expect(await clientApiContext(request())).toBeNull();
    fixture.authenticated = true;
    fixture.session.expiresAt = new Date(0);
    expect(await clientApiContext(request())).toBeNull();
    fixture.session.expiresAt = new Date(Date.now() + 60000);
    fixture.session.revokedAt = new Date();
    expect(await clientApiContext(request())).toBeNull();
    fixture.session.revokedAt = null;
    fixture.session.approvedByUserId = "";
    expect(await clientApiContext(request())).toBeNull();
  });
  it("allows reads but denies every mutation for a read session", async () => {
    fixture.session.permission = "read";
    expect(await clientApiContext(request())).toMatchObject({ accessLevel: "read_only" });
    for (const method of ["POST", "PATCH", "DELETE"]) expect(await clientApiContext(request(method))).toBeNull();
  });
  it("restricts emergency sessions to current super administrators", async () => {
    fixture.session.approvedByUserId = "";
    fixture.session.breakGlass = true;
    expect(await clientApiContext(request("PATCH"))).toBeNull();
    fixture.operator.role = "super_admin";
    expect(await clientApiContext(request("PATCH"))).toMatchObject({ accessLevel: "full" });
  });
  it("rejects malformed identifiers before accessing PostgreSQL", async () => {
    expect(await clientApiContext(new Request("http://localhost/api/platform/support/not-a-uuid/clients"))).toBeNull();
    expect(createDatabase).not.toHaveBeenCalled();
  });
});
