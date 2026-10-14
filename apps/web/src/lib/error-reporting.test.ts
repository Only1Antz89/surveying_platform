import { describe, expect, it } from "vitest";
import { safeErrorEvent, scrubMessage } from "./error-reporting";

describe("built-in error reporting", () => {
  it("removes identifiers, contact details, links and credentials from messages", () => {
    const message = scrubMessage("Job 3f2b9c1e-1111-4222-8333-444455556666 for jo@example.com failed calling https://api.example.com/x?token=abc with sk_live_ABCDEFGH1234 ref 123456");
    expect(message).toBe("Job <id> for <email> failed calling <url> with <secret> ref <n>");
  });
  it("groups the same failure on the same route and keeps only safe request details", () => {
    const first = safeErrorEvent(new TypeError("Cannot read x of 3f2b9c1e-1111-4222-8333-444455556666"), { path: "/api/v1/jobs/3f2b9c1e-1111-4222-8333-444455556666?secret=1", method: "GET" }, { routeType: "route" });
    const second = safeErrorEvent(new TypeError("Cannot read x of 9f2b9c1e-1111-4222-8333-444455556666"), { path: "/api/v1/jobs/9f2b9c1e-1111-4222-8333-444455556666", method: "GET" }, { routeType: "route" });
    expect(first).toMatchObject({ routePath: "/api/v1/jobs/[id]", errorName: "TypeError", routeType: "route", method: "GET" });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(JSON.stringify(first)).not.toContain("secret=1");
  });
  it("prefers the route file path and accepts only well-formed digests and methods", () => {
    const event = safeErrorEvent(Object.assign(new Error("boom"), { digest: "<script>" }), { path: "/app/demo/jobs/abc", method: "get; drop" }, { routePath: "/app/[organisationSlug]/jobs/[id]", routeType: "render" });
    expect(event).toMatchObject({ routePath: "/app/[organisationSlug]/jobs/[id]", digest: null, method: "OTHER" });
    expect(safeErrorEvent("plain", { path: "/", method: "POST" }, {}).errorName).toBe("string");
  });
});
