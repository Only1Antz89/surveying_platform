import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ context: { organisationId: "11111111-1111-4111-8111-111111111111", internalUserId: "manager", role: "owner", demo: false }, writable: true, request: vi.fn(), cancel: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/access", () => ({ apiContext: async () => state.context, canWriteWorkspace: () => state.writable }));
vi.mock("@/lib/workspace-api-guard", () => ({ workspaceApiGuard: async () => null }));
vi.mock("@/lib/survey-file-removal-request", () => ({ requestReviewedSurveyFileRemoval: state.request, cancelReviewedSurveyFileRemoval: state.cancel }));
vi.mock("@surveynt/db", () => ({ createDatabase: state.database, withTenant: async (_db: unknown, _org: string, callback: (tx: unknown) => unknown) => callback({}) }));
import { POST } from "./route";
const id = "22222222-2222-4222-8222-222222222222";
const route = { params: Promise.resolve({ id }) };
const decision = { action: "request", requestId: id, reviewVersion: "a".repeat(64), reason: "Manager reviewed the removal decision.", confirmed: true };
const request = (body: unknown = decision) => new Request("http://surveynt.test/removals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); Object.assign(state.context, { role: "owner", demo: false }); state.writable = true; state.request.mockResolvedValue({ id, status: "queued", storageRemoved: false }); state.cancel.mockResolvedValue({ id, status: "cancelled" }); });
it("queues the reviewed decision without forwarding client storage paths", async () => {
  expect((await POST(request(), route)).status).toBe(200);
  expect(state.request).toHaveBeenCalledWith(expect.anything(), state.context.organisationId, id, "manager", { requestId: id, reviewVersion: decision.reviewVersion, reason: decision.reason, confirmed: true });
  expect((await POST(request({ ...decision, storagePath: "untrusted" }), route)).status).toBe(400);
});
it("routes cancellation to its current manifest binding", async () => {
  expect((await POST(request({ action: "cancel", id, manifestVersion: "b".repeat(64), reason: decision.reason, confirmed: true }), route)).status).toBe(200);
  expect(state.cancel).toHaveBeenCalledOnce(); expect(state.request).not.toHaveBeenCalled();
});
it("denies non-management and read-only writes", async () => {
  state.context.role = "surveyor"; expect((await POST(request(), route)).status).toBe(403);
  state.context.role = "owner"; state.writable = false; expect((await POST(request(), route)).status).toBe(403);
  expect(state.database).not.toHaveBeenCalled();
});
it("does not persist preview decisions or expose internal database errors", async () => {
  state.context.demo = true; expect((await (await POST(request(), route)).json()).data.persisted).toBe(false); expect(state.database).not.toHaveBeenCalled();
  state.context.demo = false; state.request.mockRejectedValue(new Error("private database details"));
  const response = await POST(request(), route); expect(response.status).toBe(409); expect(await response.text()).not.toContain("private database details");
});
