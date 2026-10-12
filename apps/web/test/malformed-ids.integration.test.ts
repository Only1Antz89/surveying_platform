import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { entitlements, organisationMemberships, organisations, platformStaff, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
// Only Clerk's session lookup is substituted; every route runs its real access checks against PostgreSQL.
// 503 means an unconfigured integration, which is a correct answer; 500s and thrown errors are not.
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_malformed_probe", orgId: "org_malformed_probe" }), currentUser: async () => null, clerkClient: async () => ({}) }));
vi.mock("server-only", () => ({}));

const apiRoot = join(__dirname, "../src/app/api");
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? routes(path) : name === "route.ts" ? [path] : []; });
}
// Every dynamic segment receives a value no stored identifier can have.
const apiRoutes = routes(apiRoot).map((file) => relative(apiRoot, file).replace(/\/route\.ts$/, "")).filter((path) => !/^(webhooks|queues|cron)\//.test(path));
const dynamicRoutes = apiRoutes.filter((path) => path.includes("["));
const staticRoutes = apiRoutes.filter((path) => !path.includes("["));

describe.skipIf(!integrationEnabled)("malformed input never causes server errors", () => {
  let database: TestDatabase, db: Database;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl); vi.stubEnv("DATABASE_APP_URL", database.appUrl);
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fictional"); vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fictional");
    const [org] = await db.insert(organisations).values({ clerkOrganisationId: "org_malformed_probe", slug: "malformed-probe", name: "Malformed probe", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    const [user] = await db.insert(users).values({ clerkUserId: "user_malformed_probe", email: "probe@example.test" }).returning();
    await db.insert(organisationMemberships).values({ organisationId: org.id, userId: user.id, role: "owner", active: true, canRecordSurvey: true, canApproveReports: true });
    await db.insert(entitlements).values({ organisationId: org.id, key: "billing_exempt", enabled: true });
    await db.insert(platformStaff).values({ clerkUserId: "user_malformed_probe", role: "super_admin" });
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  async function probe(list: string[], methods: string[]) {
    const failures: string[] = [];
    for (const route of list) {
      const handlers = await import(`../src/app/api/${route}/route`) as Record<string, unknown>;
      const names = [...route.matchAll(/\[(?:\.\.\.)?(\w+)\]/g)].map((match) => match[1]);
      const params = Object.fromEntries(names.map((name) => [name, "not-a-valid-id"]));
      const url = `https://surveynt.test/api/${route.replace(/\[(?:\.\.\.)?\w+\]/g, "not-a-valid-id")}`;
      for (const method of methods) {
        const handler = handlers[method];
        if (typeof handler !== "function") continue;
        const init: RequestInit = { method, headers: { "content-type": "application/json", "x-quote-token": "probe-token" }, ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }) };
        try {
          const response = await (handler as (request: Request, context: unknown) => Promise<Response>)(new Request(url, init), { params: Promise.resolve(params) });
          if (response.status >= 500 && response.status !== 503) failures.push(`${method} /api/${route} -> ${response.status} ${(await response.text()).slice(0, 120)}`);
        } catch (error) { failures.push(`${method} /api/${route} threw ${(error as Error).message.slice(0, 160)}`); }
      }
    }
    return failures;
  }

  it(`answers ${dynamicRoutes.length} dynamic routes with client errors`, async () => {
    expect(await probe(dynamicRoutes, ["GET", "POST", "PATCH", "PUT", "DELETE"])).toEqual([]);
  }, 300000);

  it(`answers reads and empty writes on ${staticRoutes.length} static routes without server errors`, async () => {
    expect(await probe(staticRoutes, ["GET", "POST", "PATCH", "PUT", "DELETE"])).toEqual([]);
  }, 300000);
});
