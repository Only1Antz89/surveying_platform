import { afterEach, describe, expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
import { getObjectStorage } from "./storage";

describe("Vercel Blob adapter", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("is unavailable until a store token is configured", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(getObjectStorage()).toBeNull();
  });
  it("writes private, non-overwriting objects and reads them privately", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_fictional");
    const storage = getObjectStorage()!;
    await storage.put("organisations/o/surveys/s/m/original", new ArrayBuffer(4), "image/jpeg");
    expect(blob.put).toHaveBeenCalledWith("organisations/o/surveys/s/m/original", expect.any(Buffer), { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: false, token: "vercel_blob_rw_fictional" });
    blob.get.mockResolvedValue({ stream: new ReadableStream(), blob: { contentType: "image/jpeg" } });
    await storage.get("key");
    expect(blob.get).toHaveBeenLastCalledWith("key", { access: "private", token: "vercel_blob_rw_fictional" });
  });
  it("bypasses the provider cache for fresh reads such as removal verification", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_fictional");
    blob.get.mockResolvedValue(null);
    expect(await getObjectStorage()!.get("key", { fresh: true })).toBeNull();
    expect(blob.get).toHaveBeenLastCalledWith("key", { access: "private", token: "vercel_blob_rw_fictional", useCache: false });
  });
});
