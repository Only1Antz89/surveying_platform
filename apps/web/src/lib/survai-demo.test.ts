import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocked = vi.hoisted(() => ({ answer: vi.fn(), web: vi.fn(), forecast: vi.fn(), postcode: vi.fn() }));
vi.mock("./surveyant-chat", () => ({ conversationalAnswer: mocked.answer }));
vi.mock("./gemini-native", () => ({ groundedWebAnswer: mocked.web }));
vi.mock("./visit-forecast", () => ({ fetchDailyForecast: mocked.forecast }));
vi.mock("@surveynt/property-data", async original => ({ ...await original<typeof import("@surveynt/property-data")>(), lookupPostcode: mocked.postcode }));
vi.mock("./demo-store", () => ({ demoStore: { snapshot: async () => ({ tenants: [{ id: "demo-org", name: "Fictional practice", status: "active" }], clients: [] }) } }));
import { demoSurvaiSources, sendDemoSurvai, sendDemoWebAnswer } from "./survai-demo";
import { survaiContextCopy } from "./survai-context";
const manager = { demo: true, mode: "firm" as const, organisationId: "demo-org", role: "manager" as const };
beforeEach(() => {
 mocked.answer.mockReset(); mocked.web.mockReset(); mocked.forecast.mockReset(); mocked.postcode.mockReset();
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
  const cases = sources.filter(source => source.id.startsWith("demo:job:"));
  expect(cases.length).toBe(2); for (const source of cases) expect(source.data).toMatchObject({ assignee: "Maya Patel", demo: true });
  expect(JSON.stringify(sources)).not.toContain('"fee"');
 });
 it("does not manufacture balances or appointments from demonstration layouts", async () => {
  const finance = await demoSurvaiSources(manager, { page: "finance" }); expect(finance[0].data).toMatchObject({ invoices: [], verifiedPayments: [], currencies: [] });
  const calendar = await demoSurvaiSources(manager, { page: "calendar" }); expect(calendar.find(source => source.id === "demo:appointment-coverage")?.data).toMatchObject({ appointments: [] });
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

 it("gives the selected case its form state, weather outlook, property history and approved wording", async () => {
  const sources = await demoSurvaiSources(manager, { page: "survey", resourceId: "job_01" });
  const ids = sources.map(source => source.id);
  expect(ids).toContain("demo:job:job_01");
  expect(ids.some(id => id.startsWith("demo:form:"))).toBe(true);
  expect(ids.some(id => id.startsWith("demo:history:prop_01"))).toBe(true);
  expect(ids.some(id => id.startsWith("demo:property-intel:prop_01"))).toBe(true);
  expect(ids.some(id => id.startsWith("demo:wording:"))).toBe(true);
  const outlook = sources.find(source => source.id === "demo:forecast:job_01");
  expect(outlook?.data).toMatchObject({ demo: true, assessment: { level: "elevated", exposure: "external_elements" } });
  expect(JSON.stringify(sources)).not.toContain('"fee":');
  for (const source of sources.filter(source => source.id !== "general:professional-knowledge")) expect(JSON.stringify(source.data)).toContain("demo");
 });
 it("keeps another surveyor's case out of a surveyor's selection", async () => {
  const sources = await demoSurvaiSources({ ...manager, role: "surveyor" }, { page: "job", resourceId: "job_02" });
  expect(sources.map(source => source.id)).toEqual(["demo:selection"]);
 });
 it("finds a permitted property named in the question by postcode", async () => {
  const sources = await demoSurvaiSources(manager, { page: "overview" }, "What is the history of BS8 4JX?");
  expect(sources.some(source => source.id.startsWith("demo:history:prop_01"))).toBe(true);
  expect(sources.some(source => source.id === "general:professional-knowledge")).toBe(true);
 });
 it("summarises weather risk for upcoming fictional visits on planning pages", async () => {
  const sources = await demoSurvaiSources(manager, { page: "calendar" });
  const outlooks = sources.filter(source => source.id.startsWith("demo:forecast:"));
  expect(outlooks.length).toBeGreaterThan(0);
  expect(outlooks.some(source => (source.data as { assessment: { flags: { code: string }[] } }).assessment.flags.some(flag => flag.code === "heavy_rain"))).toBe(true);
 });
 it("offers a confirmed web search only with free evaluation services enabled and records falling short", async () => {
  mocked.answer.mockResolvedValue({ content: "Not in the fictional records.", citations: [], coverage: "not_in_records", webQuery: "Party Wall Act notice period for loft conversions" });
  const off = await sendDemoSurvai(manager, { message: "What notice does the Party Wall Act need?", pageContext: { page: "overview" } });
  expect(off.message.webProposal).toBeNull();
  vi.stubEnv("SURVEYNT_DEMO_EVALUATION_SERVICES", "true");
  const on = await sendDemoSurvai(manager, { message: "What notice does the Party Wall Act need for a loft?", pageContext: { page: "overview" } });
  expect(on.message.webProposal).toMatchObject({ query: "Party Wall Act notice period for loft conversions" });
  mocked.answer.mockResolvedValue({ content: "Answered from records.", citations: [{ id: "demo:x", label: "x", href: "jobs" }], coverage: "answered", webQuery: null });
  expect((await sendDemoSurvai(manager, { message: "Summarise my cases", pageContext: { page: "overview" } })).message.webProposal).toBeNull();
  mocked.answer.mockResolvedValue({ content: "No.", citations: [], coverage: "not_in_records", webQuery: "average survey fees UK" });
  expect((await sendDemoSurvai(manager, { message: "Benchmark our fees", pageContext: { page: "finance" } })).message.webProposal).toBeNull();
 });
 it("runs only the confirmed query, for the same demo user, and labels the answer as web content", async () => {
  vi.stubEnv("SURVEYNT_DEMO_EVALUATION_SERVICES", "true");
  mocked.answer.mockResolvedValue({ content: "Not in records.", citations: [], coverage: "not_in_records", webQuery: "Met Office heavy rain warning guidance" });
  const proposal = (await sendDemoSurvai(manager, { message: "What does an amber rain warning mean?", pageContext: { page: "overview" } })).message.webProposal!;
  await expect(sendDemoWebAnswer({ ...manager, role: "surveyor" }, { token: proposal.token })).rejects.toThrow("expired");
  await expect(sendDemoWebAnswer(manager, { token: `${proposal.token}x` })).rejects.toThrow("expired");
  mocked.web.mockResolvedValue({ content: "Amber means be prepared.", citations: [{ id: "web:1", label: "Met Office", href: "https://www.metoffice.gov.uk/" }], searchQueries: [] });
  const result = await sendDemoWebAnswer(manager, { token: proposal.token });
  expect(mocked.web).toHaveBeenCalledWith(expect.objectContaining({ query: "Met Office heavy rain warning guidance", credentialEnv: "SURVEYNT_CONNECTION_SECRET_GEMINI" }));
  expect(result.message).toMatchObject({ web: true, query: "Met Office heavy rain warning guidance", citations: [{ id: "web:1" }] });
  expect(result.message.content).toBe("Amber means be prepared.");
 });
 it("replaces the fictional outlook with a live free forecast for the visit postcode area, falling back safely", async () => {
  vi.stubEnv("SURVEYNT_DEMO_EVALUATION_SERVICES", "true");
  // Earlier failed lookups are cached briefly; move past that window.
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 60 * 60_000);
  mocked.postcode.mockResolvedValue({ status: "matched", result: { latitude: 51.5, longitude: -0.12 } });
  mocked.forecast.mockImplementation(async (_endpoint: string, _point: unknown, date: string) => ({ date, precipitationSumMm: 22, precipitationProbabilityPercent: 90, windSpeedMaxKmh: 30, weatherCode: 65, temperatureMaxC: 12, temperatureMinC: 8 }));
  const live = (await demoSurvaiSources(manager, { page: "calendar" })).filter(source => source.id.startsWith("demo:forecast:"));
  expect(live.length).toBeGreaterThan(0);
  expect(live[0].label).toContain("live weather forecast");
  expect(live[0].data).toMatchObject({ forecast: { precipitationSumMm: 22 }, source: expect.stringContaining("Open-Meteo") });
  expect(mocked.forecast.mock.calls[0][0]).toBe("https://api.open-meteo.com");
  vi.useRealTimers();
 });
});
