import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocked = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock("./surveyant-chat", () => ({ conversationalAnswer: mocked.answer }));
vi.mock("./demo-store", () => ({ demoStore: { snapshot: async () => ({ tenants: [{ id: "demo-org", name: "Fictional practice", status: "active" }], clients: [] }) } }));
import { demoSurvaiSources, sendDemoSurvai } from "./survai-demo";
import { survaiContextCopy } from "./survai-context";
const manager = { demo: true, mode: "firm" as const, organisationId: "demo-org", role: "manager" as const };
beforeEach(() => {
 mocked.answer.mockReset();
 vi.stubEnv("SURVEYNT_DEMO_AI_ENABLED", "true"); vi.stubEnv("SURVEYNT_CONNECTION_SECRET_GEMINI", "test-only-secret");
 vi.stubEnv("SURVEYNT_DEMO_AI_MODEL", "gemini-3.1-flash-lite"); vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", ""); vi.stubEnv("CLERK_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());
describe("fictional Gemini demo adapter", () => {
 it("cannot send authenticated production records, even with the preview flag enabled", async () => {
  await expect(sendDemoSurvai({ ...manager, demo: false }, { message: "Review", pageContext: { page: "finance" } })).rejects.toThrow("production");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "configured"); vi.stubEnv("CLERK_SECRET_KEY", "configured");
  await expect(sendDemoSurvai(manager, { message: "Review" })).rejects.toThrow("production"); expect(mocked.answer).not.toHaveBeenCalled();
 });
 it("enforces role boundaries before contacting Gemini", async () => {
  await expect(sendDemoSurvai({ ...manager, role: "surveyor" }, { message: "Finance", pageContext: { page: "finance" } })).rejects.toThrow("access"); expect(mocked.answer).not.toHaveBeenCalled();
 });
 it("requires both explicit enablement and a server credential", async () => {
  vi.stubEnv("SURVEYNT_DEMO_AI_ENABLED", "false"); await expect(sendDemoSurvai(manager, { message: "Review" })).rejects.toThrow("provider");
  vi.stubEnv("SURVEYNT_DEMO_AI_ENABLED", "true"); vi.stubEnv("SURVEYNT_CONNECTION_SECRET_GEMINI", ""); await expect(sendDemoSurvai(manager, { message: "Review" })).rejects.toThrow("provider"); expect(mocked.answer).not.toHaveBeenCalled();
 });
 it("uses assigned fictional cases and omits surveyor fees", async () => {
  const sources = await demoSurvaiSources({ ...manager, role: "surveyor" }, { page: "jobs" });
  expect(sources.length).toBe(2); for (const source of sources) { expect(source.data).toMatchObject({ assignee: "Maya Patel", demo: true }); expect(JSON.stringify(source.data)).not.toContain('"fee"'); }
 });
 it("does not manufacture balances or appointments from demonstration layouts", async () => {
  const finance = await demoSurvaiSources(manager, { page: "finance" }); expect(finance[0].data).toMatchObject({ invoices: [], verifiedPayments: [], currencies: [] });
  const calendar = await demoSurvaiSources(manager, { page: "calendar" }); expect(calendar.at(-1)?.data).toMatchObject({ appointments: [] });
 });
 it("uses the configured 3.1 model, adds demo provenance, and caches only known tasks", async () => {
  mocked.answer.mockResolvedValue({ content: "No invoices are supplied.", citations: [{ id: "demo:finance", label: "Empty demo ledger", href: "finance" }] });
  const question = survaiContextCopy({ page: "finance" }, { mode: "firm", role: "manager" }).actions[0].question;
  const result = await sendDemoSurvai(manager, { message: question, pageContext: { page: "finance" } });
  expect(result.message).toMatchObject({ demo: true, model: "gemini-3.1-flash-lite" });
  expect(mocked.answer.mock.calls[0][0]).toMatchObject({ providerKey: "gemini", credentialEnv: "SURVEYNT_CONNECTION_SECRET_GEMINI" });
  expect(mocked.answer.mock.calls[0][1]).toBe("gemini-3.1-flash-lite"); expect(JSON.stringify(result)).not.toContain("test-only-secret");
  expect((await sendDemoSurvai(manager, { message: question, pageContext: { page: "finance" } })).cached).toBe(true); expect(mocked.answer).toHaveBeenCalledTimes(1);
  await sendDemoSurvai(manager, { message: "Unique request", pageContext: { page: "finance" } }); await sendDemoSurvai(manager, { message: "Unique request", pageContext: { page: "finance" } }); expect(mocked.answer).toHaveBeenCalledTimes(3);
 });
 it("restricts platform output to fictional lifecycle counts", async () => {
  const sources = await demoSurvaiSources({ demo: true, mode: "platform", platformRole: "super_admin" }, { page: "platform-practices" });
  expect(sources[0].data).toMatchObject({ counts: { active: 1 } }); expect(sources[0].data).not.toHaveProperty("name"); expect(JSON.stringify(sources[0].data)).not.toContain("demo-org");
 });
 it("bounds concurrent provider calls before another request can spend tokens", async () => {
  const release: (() => void)[] = [];
  mocked.answer.mockImplementation(() => new Promise(resolve => release.push(() => resolve({ content: "Empty ledger", citations: [{ id: "demo:finance", label: "Ledger", href: "finance" }] }))));
  const first = sendDemoSurvai(manager, { message: "Concurrent one", pageContext: { page: "finance" } });
  const second = sendDemoSurvai(manager, { message: "Concurrent two", pageContext: { page: "finance" } });
  await vi.waitFor(() => expect(mocked.answer).toHaveBeenCalledTimes(2));
  await expect(sendDemoSurvai(manager, { message: "Concurrent three", pageContext: { page: "finance" } })).rejects.toThrow("busy");
  for (const done of release) done(); await Promise.all([first, second]); expect(mocked.answer).toHaveBeenCalledTimes(2);
 });
});
