import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sweep = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/email", () => ({ emailDeliveryConfigured: () => false }));
vi.mock("@/lib/email-queue", () => ({ enqueueDailyNotifications: async () => ({ queued: 0 }), processEmailQueue: async () => ({}) }));
vi.mock("@/lib/intelligence", () => ({ processIntelligenceQueue: async () => ({ claimed: 0, results: [] }) }));
vi.mock("@/lib/media-analysis", () => ({ processMediaAnalysisBacklog: async () => ({ analysed: 0 }) }));
vi.mock("@/lib/data-source-admin", () => ({ runDataSourceSweep: async () => ({ probed: 0, stale: [] }) }));
vi.mock("@/lib/calendar-sync", () => ({ enqueueCalendarReconciliation: async () => ({ eligible: 0, queued: 0 }), processCalendarQueue: async () => ({ claimed: 0, results: [] }) }));
vi.mock("@/lib/learning-pipeline", () => ({ runLearningSweep: sweep.run }));
import { GET } from "./route";

const run = () => GET(new Request("https://surveynt.test/api/cron/daily", { headers: { authorization: "Bearer cron-test" } }));

describe("daily cron learning sweep", () => {
  beforeEach(() => { vi.stubEnv("CRON_SECRET", "cron-test"); vi.stubEnv("DATABASE_ADMIN_URL", "postgres://fictional"); sweep.run.mockReset(); });
  afterEach(() => vi.unstubAllEnvs());
  it("retries withdrawals and survey-file removals every day and reports counts only", async () => {
    sweep.run.mockResolvedValue({ withdrawals: 1, removedFiles: { files: 2, candidatesErased: 3, sharedCasesRemoved: 0 }, firms: 0, created: 0, inactive: ["flag_off"] });
    const body = await (await run()).json();
    expect(sweep.run).toHaveBeenCalledWith(5);
    expect(body.learning).toEqual({ withdrawals: 1, filesErased: 2, created: 0 });
  });
  it("keeps the other daily jobs running when the learning sweep fails", async () => {
    sweep.run.mockRejectedValue(new Error("learning database unavailable"));
    const response = await run();
    expect(response.status).toBe(200);
    expect((await response.json()).learning).toEqual({ withdrawals: 0, filesErased: 0, created: 0 });
  });
  it("rejects unauthenticated runs before any work", async () => {
    expect((await GET(new Request("https://surveynt.test/api/cron/daily"))).status).toBe(401);
    expect(sweep.run).not.toHaveBeenCalled();
  });
});
