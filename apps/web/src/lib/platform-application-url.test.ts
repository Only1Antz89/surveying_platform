import { afterEach, describe, it, expect, vi } from "vitest";
import {
  platformApplicationUrl,
  platformInvitationsConfigured,
} from "./platform-application-url";
afterEach(() => vi.unstubAllEnvs());
describe("platform invitation destinations", () => {
  it("uses the server-controlled origin before the public fallback", () => {
    vi.stubEnv("APP_URL", "https://surveynt.test/path");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://other.test");
    expect(platformApplicationUrl()).toBe("https://surveynt.test");
  });
  it("rejects insecure production URLs and credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://surveynt.test");
    expect(() => platformApplicationUrl()).toThrow();
    vi.stubEnv("APP_URL", "https://user:password@surveynt.test");
    expect(() => platformApplicationUrl()).toThrow();
  });
  it("keeps invitation actions disabled without account synchronisation", () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", "");
    expect(platformInvitationsConfigured()).toBe(false);
  });
});
