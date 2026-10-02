import { describe, expect, it } from "vitest";

import { isWorkerAuthorised } from "./worker-auth";

describe("property intelligence worker authentication", () => {
  it("rejects requests when no worker secret is configured", () => {
    expect(isWorkerAuthorised(null)).toBe(false);
    expect(isWorkerAuthorised("Bearer anything", "", "")).toBe(false);
  });

  it("accepts either configured worker credential", () => {
    expect(isWorkerAuthorised("Bearer queue-secret", "queue-secret", "cron-secret")).toBe(true);
    expect(isWorkerAuthorised("Bearer cron-secret", "queue-secret", "cron-secret")).toBe(true);
    expect(isWorkerAuthorised("Bearer wrong-secret", "queue-secret", "cron-secret")).toBe(false);
  });
});
