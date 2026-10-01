import { describe, expect, it, vi } from "vitest";
import { ProviderError, providerFetchJson, withTransientRetry } from "./provider-fetch";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("provider fetch", () => {
  it("refuses hosts outside the adapter allowlist", async () => {
    const fetchImpl = vi.fn();
    await expect(providerFetchJson("https://169.254.169.254/latest", { allowedHosts: ["api.postcodes.io"], fetchImpl })).rejects.toMatchObject({ code: "host_not_allowed" });
    await expect(providerFetchJson("http://api.postcodes.io/x", { allowedHosts: ["api.postcodes.io"], fetchImpl })).rejects.toMatchObject({ code: "host_not_allowed" });
    await expect(providerFetchJson("https://user:pass@api.postcodes.io/x", { allowedHosts: ["api.postcodes.io"], fetchImpl })).rejects.toMatchObject({ code: "host_not_allowed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats redirects as errors so a provider cannot bounce requests elsewhere", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    await expect(providerFetchJson("https://api.postcodes.io/x", { allowedHosts: ["api.postcodes.io"], fetchImpl })).rejects.toMatchObject({ code: "redirect" });
  });

  it("caps response size", async () => {
    const fetchImpl = vi.fn(async () => json({ data: "x".repeat(5000) }));
    await expect(providerFetchJson("https://api.postcodes.io/x", { allowedHosts: ["api.postcodes.io"], fetchImpl, maxBytes: 1000 })).rejects.toMatchObject({ code: "too_large" });
  });

  it("classifies timeouts, rate limits and server errors as transient", async () => {
    const timeout = vi.fn(async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); });
    const error = await providerFetchJson("https://api.postcodes.io/x", { allowedHosts: ["api.postcodes.io"], fetchImpl: timeout }).catch((reason) => reason);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.transient).toBe(true);
    const limited = await providerFetchJson("https://api.postcodes.io/x", { allowedHosts: ["api.postcodes.io"], fetchImpl: vi.fn(async () => json({}, 429)) }).catch((reason) => reason);
    expect(limited.code).toBe("rate_limited");
    const rejected = await providerFetchJson("https://api.postcodes.io/x", { allowedHosts: ["api.postcodes.io"], fetchImpl: vi.fn(async () => json({}, 400)) }).catch((reason) => reason);
    expect(rejected.transient).toBe(false);
  });

  it("retries only transient failures", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls += 1;
      if (calls === 1) throw new ProviderError("http_server", "busy", 503);
      return "ok";
    }, { attempts: 3, sleep });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    let clientCalls = 0;
    await expect(withTransientRetry(async () => { clientCalls += 1; throw new ProviderError("http_client", "bad", 400); }, { attempts: 3, sleep })).rejects.toBeInstanceOf(ProviderError);
    expect(clientCalls).toBe(1);
  });
});
