import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { organisationMemberships, organisations, platformConnections, surveyantMessages, tenantConnections, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
const network = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/connection-network", () => ({ connectionJson: network }));
import { sendWebAnswer } from "../src/lib/surveyant-chat";
import { decideWebProposal } from "../src/lib/survai-web-router";
import type { ChatContext } from "../src/lib/surveyant-chat";

describe.skipIf(!integrationEnabled)("SurvAI confirmed web search", () => {
  let database: TestDatabase, db: Database;
  let manager: ChatContext, colleague: ChatContext;
  const propose = (context: ChatContext) => decideWebProposal({ enabled: true, coverage: "not_in_records", suggestedQuery: "Party Wall Act notice period for loft conversions", question: "q", sources: [], organisationId: context.organisationId, userId: context.internalUserId! })!;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    vi.stubEnv("SURVEYNT_CONNECTION_SECRET_GEMINI", "test-only-secret");
    const [org] = await db.insert(organisations).values({ clerkOrganisationId: "org_survai_web", slug: "survai-web", name: "Web practice", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    const people = await db.insert(users).values([{ clerkUserId: "user_w_manager", email: "m@w.test" }, { clerkUserId: "user_w_colleague", email: "c@w.test" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org.id, userId: people[0].id, role: "manager" }, { organisationId: org.id, userId: people[1].id, role: "manager" }]);
    manager = { organisationId: org.id, internalUserId: people[0].id, role: "manager" };
    colleague = { organisationId: org.id, internalUserId: people[1].id, role: "manager" };
    const [connection] = await db.insert(platformConnections).values({ name: "Gemini", kind: "ai", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", credentialEnv: "SURVEYNT_CONNECTION_SECRET_GEMINI", modelId: "gemini-3.1-flash-lite", providerKey: "gemini", enabled: true, evaluationOnly: false }).returning();
    await db.insert(tenantConnections).values({ organisationId: org.id, connectionId: connection.id, enabled: true });
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("is unavailable until web search is switched on for a Gemini connection", async () => {
    vi.stubEnv("SURVAI_WEB_SEARCH_ENABLED", "false");
    await expect(sendWebAnswer(manager, { token: propose(manager).token })).rejects.toMatchObject({ status: 503, code: "web_search_unavailable" });
  });
  it("runs only a proposal signed for the same user and practice", async () => {
    vi.stubEnv("SURVAI_WEB_SEARCH_ENABLED", "true");
    await expect(sendWebAnswer(colleague, { token: propose(manager).token })).rejects.toMatchObject({ status: 410 });
    await expect(sendWebAnswer({ ...manager, organisationId: "00000000-0000-4000-8000-000000000000" }, { token: propose(manager).token })).rejects.toMatchObject({ status: 503 });
  });
  it("still requires AI governance approval before contacting Google, and saves nothing when refused", async () => {
    vi.stubEnv("SURVAI_WEB_SEARCH_ENABLED", "true");
    await expect(sendWebAnswer(manager, { token: propose(manager).token })).rejects.toMatchObject({ status: 409, code: "governance_required" });
    expect(network).not.toHaveBeenCalled();
    expect(await db.select().from(surveyantMessages)).toEqual([]);
  });
});
