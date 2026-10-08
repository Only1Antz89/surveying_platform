import { beforeEach, expect, it, vi } from "vitest";
import type { Database } from "@surveynt/db";
import { createMemoryStorage } from "./storage";
import { processReviewedQueuedOriginals } from "./survey-file-removal-start-runner";
const mocks = vi.hoisted(() => ({ resume: vi.fn(), process: vi.fn(), update: vi.fn(), audit: vi.fn(), selects: 0 }));
vi.mock("./survey-file-removal-start", () => ({ startReviewedSurveyFileRemoval: mocks.resume }));
vi.mock("./survey-file-removal-storage", () => ({ processSurveyFileOriginal: mocks.process }));
vi.mock("@surveynt/db", async importOriginal => ({ ...await importOriginal<typeof import("@surveynt/db")>(), withTenant: async (_db: unknown, _org: string, callback: (tx: unknown) => unknown) => callback({
  select: () => { const chain = { from: () => chain, where: () => chain, for: async () => ++mocks.selects === 1 ? [{ id: "job" }] : [{ id: "removal", status: "dispatched", leaseToken: "lease" }] }; return chain; },
  update: () => ({ set: (value: unknown) => { mocks.update(value); return { where: async () => undefined }; } }),
  insert: () => ({ values: mocks.audit }),
}) }));
const decision = { id: "removal", manifestVersion: "a".repeat(64), reason: "Confirmed reviewed execution", confirmed: true as const };
const run = () => processReviewedQueuedOriginals({} as Database, "org", "job", "manager", decision, createMemoryStorage());
beforeEach(() => { vi.clearAllMocks(); mocks.selects = 0; mocks.process.mockResolvedValue({ removed: true, verificationRequired: false }); mocks.resume.mockResolvedValue({ id: "removal", leaseToken: "lease", remaining: [{ kind: "questionnaire", id: "first" }] }); });
it("processes only server-selected untouched originals after the claim", async () => {
  expect(await run()).toEqual({ completed: true, verificationRequired: false, processed: 1 });
  expect(mocks.process).toHaveBeenCalledWith(expect.anything(), "org", "job", expect.anything(), "questionnaire:first", expect.anything());
  expect(mocks.resume.mock.invocationCallOrder[0]).toBeLessThan(mocks.process.mock.invocationCallOrder[0]);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("stops immediately on an uncertain outcome", async () => {
  mocks.process.mockResolvedValue({ removed: false, verificationRequired: true });
  expect(await run()).toEqual({ completed: false, verificationRequired: true, processed: 0 });
  expect(mocks.process).toHaveBeenCalledOnce();
});
it("pauses a batch after 25 originals without abandoning the active lease", async () => {
  mocks.resume.mockResolvedValue({ id: "removal", leaseToken: "lease", remaining: Array.from({ length: 26 }, (_, index) => ({ kind: "questionnaire", id: String(index) })) });
  expect(await run()).toEqual({ completed: false, verificationRequired: true, processed: 25 });
  expect(mocks.process).toHaveBeenCalledTimes(25);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "verification_required", lockedUntil: null }));
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "manager", action: "job.original_removal_batch_paused" }));
});
it("pauses before dispatch when the time budget has elapsed", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(40001);
  try {
    expect(await run()).toEqual({ completed: false, verificationRequired: true, processed: 0 });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "verification_required", lockedUntil: null }));
  } finally { clock.mockRestore(); }
});
it("does not process storage when the reviewed claim is rejected", async () => {
  mocks.resume.mockRejectedValue(new Error("Review changed"));
  await expect(run()).rejects.toThrow("Review changed");
  expect(mocks.process).not.toHaveBeenCalled();
});
