import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readPublicQuote } from "./firm-operations";
import { GET as publicServices } from "@/app/api/v1/public/services/route";
import { GET as quoteAppointments } from "@/app/api/v1/public/quotes/[id]/appointments/route";

describe("public quote input handling", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("treats malformed identifiers and tokens as not found before any query", async () => {
    vi.stubEnv("DATABASE_ADMIN_URL", "postgres://never-contacted.invalid/db");
    for (const [id, token] of [["x1", "token"], ["1; drop table", "token"], ["00000000-0000-4000-8000-000000000001", ""], ["00000000-0000-4000-8000-000000000001", "t".repeat(201)]]) {
      expect(await readPublicQuote(id, token)).toBeNull();
    }
  });
  it("answers a malformed link on a sub-route with a client error, not a server error", async () => {
    vi.stubEnv("DATABASE_ADMIN_URL", "postgres://never-contacted.invalid/db");
    const response = await quoteAppointments(new Request("https://surveynt.test/api/v1/public/quotes/x1/appointments", { headers: { "x-quote-token": "token" } }), { params: Promise.resolve({ id: "x1" }) } as never);
    expect(response.status).toBe(409);
  });
  it("reports unavailable online quoting instead of crashing when no database is configured", async () => {
    vi.stubEnv("DATABASE_APP_URL", ""); vi.stubEnv("DATABASE_URL", "");
    const response = await publicServices(new Request("https://surveynt.test/api/v1/public/services?organisationSlug=demo"));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("services_unavailable");
  });
});

describe("public website form without a database", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("explains that the form is not live in local preview", async () => {
    vi.stubEnv("DATABASE_APP_URL", ""); vi.stubEnv("DATABASE_URL", "");
    const { GET } = await import("@/app/api/v1/public/website-form/[organisationSlug]/route");
    const response = await GET(new Request("https://surveynt.test/api/v1/public/website-form/demo"), { params: Promise.resolve({ organisationSlug: "demo" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toContain("Website form");
  });
});

describe("public quote request without a database", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reports that online quoting is unavailable", async () => {
    vi.stubEnv("DATABASE_APP_URL", ""); vi.stubEnv("DATABASE_URL", "");
    const { POST } = await import("@/app/api/v1/public/quotes/route");
    const response = await POST(new Request("https://surveynt.test/api/v1/public/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(503);
  });
});
