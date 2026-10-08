import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ store: vi.fn(), context: { organisationId: "practice-1", internalUserId: "owner-1", role: "owner", demo: false, canRecordSurvey: true } }));
vi.mock("@/lib/access", () => ({ apiContext: async () => state.context, canWriteWorkspace: () => true }));
vi.mock("@/lib/workspace-api-guard", () => ({ workspaceApiGuard: async () => null }));
vi.mock("@/lib/professional-access", () => ({ professionalApiGuard: () => null }));
vi.mock("@/lib/surveys", () => ({ storeSurveyMedia: state.store }));
vi.mock("@/lib/media-analysis", () => ({ analyseStoredMedia: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
import { POST } from "./route";
const route = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) };
const request = (metadata: string) => {
  const form = new FormData(); form.set("metadata", metadata); form.set("file", new File(["image"], "photo.jpg", { type: "image/jpeg" }));
  return new Request("http://surveynt.test/media", { method: "POST", body: form });
};
beforeEach(() => { vi.clearAllMocks(); state.context.demo = false; });
describe("survey media request validation", () => {
  it("returns an actionable 400 for malformed JSON without uploading", async () => {
    expect((await POST(request("{broken"), route)).status).toBe(400); expect(state.store).not.toHaveBeenCalled();
  });
  it("rejects valid JSON with invalid metadata without uploading", async () => {
    expect((await POST(request("null"), route)).status).toBe(400);
    expect((await POST(request(JSON.stringify({ clientGeneratedId: "bad" })), route)).status).toBe(400);
    expect(state.store).not.toHaveBeenCalled();
  });
  it("preserves storage validation for correctly formed requests", async () => {
    state.store.mockResolvedValue({ kind: "invalid", message: "Original rejected." });
    expect((await POST(request(JSON.stringify({ clientGeneratedId: "media_request_1" })), route)).status).toBe(422);
    expect(state.store).toHaveBeenCalledOnce();
  });
});
