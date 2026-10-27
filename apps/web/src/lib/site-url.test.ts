import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "./site-url";

describe("siteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("prefers the configured site URL and drops a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://surveynt.co.uk/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "surveying-platform-taupe.vercel.app");
    expect(siteUrl()).toBe("https://surveynt.co.uk");
  });
  it("falls back to the Vercel production host", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "surveying-platform-taupe.vercel.app");
    expect(siteUrl()).toBe("https://surveying-platform-taupe.vercel.app");
  });
});
