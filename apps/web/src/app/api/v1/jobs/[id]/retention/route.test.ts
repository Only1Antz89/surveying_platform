import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ context: { organisationId: "00000000-0000-0000-0000-000000000001", internalUserId: "manager-1", role: "owner", demo: false }, read: vi.fn(), insert: vi.fn(), database: vi.fn(), member: { userId: "manager-1", role: "owner" }, writable: true }));
vi.mock("@/lib/access", () => ({ apiContext: async () => state.context, canWriteWorkspace: () => state.writable }));
vi.mock("@/lib/workspace-api-guard", () => ({ workspaceApiGuard: async () => null }));
vi.mock("@/lib/survey-file-retention-register", () => ({ readSurveyFileRetention: state.read }));
vi.mock("@surveynt/db", async importOriginal => {
  const original = await importOriginal<typeof import("@surveynt/db")>();
  return { ...original, createDatabase: state.database, withTenant: async (_db: unknown, _organisationId: string, callback: (tx: unknown) => unknown) => callback({
    select: () => ({ from: () => ({ where: () => ({ for: async () => [state.member] }) }) }),
    insert: () => ({ values: (value: unknown) => { state.insert(value); return { returning: async () => [{ id: "review-1" }] }; } }),
  }) };
});
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000002";
const route = { params: Promise.resolve({ id }) };
const version = "a".repeat(64);
const request = (body: unknown = { reviewVersion: version, reason: "Checked the complete file and practice claim register.", noUnresolvedComplaintOrClaim: true, confirmed: true }) => new Request("http://surveynt.test/retention", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(state.context, { role: "owner", demo: false }); state.member = { userId: "manager-1", role: "owner" }; state.writable = true;
  state.read.mockResolvedValue({ jobId: id, policy: { revision: 1 }, assessment: { reviewVersion: version, eligibleForManagerReview: true, retentionUntil: new Date("2001-01-01T00:00:00Z") }, documents: [{ id: "document-1" }], media: [{ id: "media-1" }], questionnaireDocuments: [{ id: "questionnaire-1" }], reportCount: 1 });
});
describe("manager survey retention review", () => {
  it("records the exact file version, claim check and no removal authority", async () => {
    const response = await POST(request(), route);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ persisted: true, removalAuthorised: false });
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "manager-1", metadata: expect.objectContaining({ reviewVersion: version, noUnresolvedComplaintOrClaim: true, removalAuthorised: false }) }));
  });
  it("rejects changed and protected files without recording approval", async () => {
    state.read.mockResolvedValueOnce({ assessment: { reviewVersion: "b".repeat(64), eligibleForManagerReview: true } });
    expect((await POST(request(), route)).status).toBe(409);
    state.read.mockResolvedValueOnce({ assessment: { reviewVersion: version, eligibleForManagerReview: false } });
    expect((await POST(request(), route)).status).toBe(409); expect(state.insert).not.toHaveBeenCalled();
  });
  it("checks current membership and management/write permissions", async () => {
    state.member.role = "surveyor"; expect((await POST(request(), route)).status).toBe(403);
    state.context.role = "surveyor"; expect((await GET(request(), route)).status).toBe(403);
    state.context.role = "owner"; state.writable = false; expect((await POST(request(), route)).status).toBe(403);
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("requires explicit claim checks and confirmation", async () => {
    expect((await POST(request({ reviewVersion: version, reason: "Manager reviewed this file", confirmed: true }), route)).status).toBe(400);
    expect(state.database).not.toHaveBeenCalled();
  });
  it("does not persist preview reviews or expose a missing job", async () => {
    state.context.demo = true; expect((await (await POST(request(), route)).json()).data.persisted).toBe(false);
    expect(state.database).not.toHaveBeenCalled();
    state.context.demo = false; state.read.mockResolvedValue(null); expect((await GET(request(), route)).status).toBe(404);
    expect(state.read).toHaveBeenCalledWith(expect.anything(), state.context.organisationId, id);
  });
});
