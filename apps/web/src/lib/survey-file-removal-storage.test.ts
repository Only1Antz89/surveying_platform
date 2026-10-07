import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@surveynt/db";
import { createMemoryStorage } from "./storage";
import { createSurveyFileRemovalManifest } from "./survey-file-removal-manifest";
import { processSurveyFileOriginal } from "./survey-file-removal-storage";
import { observeInterruptedSurveyFileOriginal } from "./survey-file-removal-recovery";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), outcome: vi.fn() }));
vi.mock("@surveynt/db", () => ({ withTenant: async (_db: unknown, _org: string, callback: (tx: unknown) => unknown) => callback({}) }));
vi.mock("./survey-file-removal-object-dispatch", () => ({ recordSurveyFileOriginalDispatch: mocks.dispatch }));
vi.mock("./survey-file-removal-object-outcome", () => ({ recordSurveyFileOriginalOutcome: mocks.outcome }));
const organisationId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const body = new TextEncoder().encode("fixture original");
const object = { kind: "questionnaire" as const, id, storagePath: `organisations/${organisationId}/preinspection/${jobId}/${id}/original`, checksum: createHash("sha256").update(body).digest("hex"), sizeBytes: body.length };
const claim = { id, leaseToken: id as typeof id, attempts: 1, lockedUntil: new Date(Date.now() + 300000), manifest: createSurveyFileRemovalManifest({ organisationId, jobId, reviewVersion: "a".repeat(64), policyVersion: "survey-file-1-year-v2", objects: [object] }) };
const objectKey = `questionnaire:${id}`;
const db = {} as Database;
describe("survey original storage processor", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.dispatch.mockResolvedValue({ dispatch: true, object }); mocks.outcome.mockResolvedValue({ status: "completed" }); });
  async function fixture() { const storage = createMemoryStorage(); await storage.put(object.storagePath, body.slice().buffer, "text/plain"); return storage; }
  it("verifies, records dispatch, removes and records observed absence", async () => {
    const storage = await fixture(); const remove = vi.spyOn(storage, "remove");
    expect(await processSurveyFileOriginal(db, organisationId, jobId, claim, objectKey, storage)).toEqual({ removed: true, verificationRequired: false });
    expect(remove).toHaveBeenCalledOnce(); expect(storage.objects.size).toBe(0);
    expect(mocks.dispatch.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    expect(mocks.outcome).toHaveBeenLastCalledWith(expect.anything(), organisationId, id, id, objectKey, { state: "removed" });
  });
  it("does not dispatch or delete checksum-mismatched originals", async () => {
    const storage = await fixture(); storage.objects.get(object.storagePath)!.body[0] ^= 1;
    await expect(processSurveyFileOriginal(db, organisationId, jobId, claim, objectKey, storage)).rejects.toThrow("checksum");
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(storage.objects.size).toBe(1);
  });
  it("does not infer successful deletion from initial absence", async () => {
    await expect(processSurveyFileOriginal(db, organisationId, jobId, claim, objectKey, createMemoryStorage())).rejects.toThrow("unexpectedly absent");
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.outcome).not.toHaveBeenCalled();
  });
  it("does not repeat an already recorded dispatch", async () => {
    const storage = await fixture(); const remove = vi.spyOn(storage, "remove"); mocks.dispatch.mockResolvedValue({ dispatch: false });
    expect(await processSurveyFileOriginal(db, organisationId, jobId, claim, objectKey, storage)).toEqual({ removed: false, verificationRequired: true });
    expect(remove).not.toHaveBeenCalled();
  });
  it("records an uncertain outcome after a lost delete response", async () => {
    const storage = await fixture(); vi.spyOn(storage, "remove").mockImplementation(async key => { storage.objects.delete(key); throw new Error("Lost response"); });
    expect(await processSurveyFileOriginal(db, organisationId, jobId, claim, objectKey, storage)).toEqual({ removed: false, verificationRequired: true });
    expect(mocks.outcome).toHaveBeenLastCalledWith(expect.anything(), organisationId, id, id, objectKey, { state: "verification_required", reason: "uncertain_delete" });
  });
  it("recovers observed absence without another delete", async () => {
    const storage = createMemoryStorage(); const remove = vi.spyOn(storage, "remove");
    expect(await observeInterruptedSurveyFileOriginal(db, organisationId, { id, leaseToken: id as typeof id, objects: [object] }, objectKey, storage)).toEqual({ removed: true, verificationRequired: false });
    expect(remove).not.toHaveBeenCalled(); expect(mocks.outcome).toHaveBeenLastCalledWith(expect.anything(), organisationId, id, id, objectKey, { state: "removed" });
  });
  it("holds a surviving original without repeat deletion", async () => {
    const storage = await fixture(); const remove = vi.spyOn(storage, "remove");
    expect(await observeInterruptedSurveyFileOriginal(db, organisationId, { id, leaseToken: id as typeof id, objects: [object] }, objectKey, storage)).toEqual({ removed: false, verificationRequired: true });
    expect(remove).not.toHaveBeenCalled(); expect(storage.objects.size).toBe(1);
    expect(mocks.outcome).toHaveBeenLastCalledWith(expect.anything(), organisationId, id, id, objectKey, { state: "verification_required", reason: "object_still_present" });
  });
  it("does not infer absence from a failed storage read", async () => {
    const storage = createMemoryStorage(); vi.spyOn(storage, "get").mockRejectedValue(new Error("Unavailable")); const remove = vi.spyOn(storage, "remove");
    await expect(observeInterruptedSurveyFileOriginal(db, organisationId, { id, leaseToken: id as typeof id, objects: [object] }, objectKey, storage)).rejects.toThrow("Unavailable");
    expect(remove).not.toHaveBeenCalled(); expect(mocks.outcome).not.toHaveBeenCalled();
  });
});
