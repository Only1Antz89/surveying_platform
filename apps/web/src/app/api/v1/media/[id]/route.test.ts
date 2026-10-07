import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ context: { organisationId: "11111111-1111-4111-8111-111111111111", demo: false }, read: vi.fn() }));
vi.mock("@/lib/access", () => ({ apiContext: async () => state.context }));
vi.mock("@/lib/workspace-api-guard", () => ({ workspaceApiGuard: async () => null }));
vi.mock("@/lib/surveys", () => ({ readSurveyMedia: state.read }));
import { GET } from "./route";
const id = "22222222-2222-4222-8222-222222222222";
const request = new Request("http://surveynt.test/media");
const route = { params: Promise.resolve({ id }) };
beforeEach(() => { vi.clearAllMocks(); state.context.demo = false; });
it("reports verified original removal without exposing storage details", async () => {
  state.read.mockResolvedValue({ removed: true }); const response = await GET(request, route);
  expect(response.status).toBe(410); expect((await response.json()).error.code).toBe("original_removed");
});
it("retains not-found behavior for unavailable or foreign originals", async () => {
  state.read.mockResolvedValue(null); expect((await GET(request, route)).status).toBe(404);
});
it("does not read persistent storage in an isolated preview", async () => {
  state.context.demo = true; expect((await GET(request, route)).status).toBe(404); expect(state.read).not.toHaveBeenCalled();
});
