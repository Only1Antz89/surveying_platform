import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appointments, clients, jobs, organisationMemberships, organisations, properties, users, wordingClauses, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { authorisedKnowledgeIds, knowledgeSources, type KnowledgeContext } from "../src/lib/survai-knowledge";
import { createSurvey, type SurveyContext } from "../src/lib/surveys";

describe.skipIf(!integrationEnabled)("SurvAI knowledge sources", () => {
  let database: TestDatabase, db: Database;
  let manager: KnowledgeContext, surveyor: KnowledgeContext, otherSurveyor: KnowledgeContext;
  let jobId = "", otherJobId = "", propertyId = "", otherPropertyId = "", appointmentId = "", clauseId = "";
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [org] = await db.insert(organisations).values({ clerkOrganisationId: "org_survai_knowledge", slug: "survai-knowledge", name: "Knowledge practice", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    const people = await db.insert(users).values([{ clerkUserId: "user_k_manager", email: "m@k.test" }, { clerkUserId: "user_k_surveyor", email: "s@k.test" }, { clerkUserId: "user_k_other", email: "o@k.test" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org.id, userId: people[0].id, role: "manager" }, { organisationId: org.id, userId: people[1].id, role: "surveyor", canRecordSurvey: true }, { organisationId: org.id, userId: people[2].id, role: "surveyor" }]);
    manager = { organisationId: org.id, internalUserId: people[0].id, role: "manager" };
    surveyor = { organisationId: org.id, internalUserId: people[1].id, role: "surveyor" };
    otherSurveyor = { organisationId: org.id, internalUserId: people[2].id, role: "surveyor" };
    const [client] = await db.insert(clients).values({ organisationId: org.id, kind: "individual", displayName: "Fictional Client" }).returning();
    const [property, otherProperty] = await db.insert(properties).values([
      { organisationId: org.id, clientId: client.id, line1: "12 Fictional Fields", city: "Bristol", postcode: "BS9 9ZZ", country: "ENG", latitude: 51.48, longitude: -2.62 },
      { organisationId: org.id, clientId: client.id, line1: "3 Other Lane", city: "Bath", postcode: "BA1 9ZZ", country: "ENG" },
    ]).returning();
    propertyId = property.id; otherPropertyId = otherProperty.id;
    const [job, otherJob] = await db.insert(jobs).values([
      { organisationId: org.id, clientId: client.id, propertyId, reference: "K-1", serviceName: "Topographic land survey", stage: "scheduled", assignedSurveyorId: surveyor.internalUserId },
      { organisationId: org.id, clientId: client.id, propertyId: otherPropertyId, reference: "K-2", serviceName: "Level 2 Home Survey", stage: "scheduled", assignedSurveyorId: otherSurveyor.internalUserId },
    ]).returning();
    jobId = job.id; otherJobId = otherJob.id;
    const tomorrow = new Date(Date.now() + 86_400_000);
    const [visit] = await db.insert(appointments).values({ organisationId: org.id, jobId, surveyorId: surveyor.internalUserId, startsAt: tomorrow, endsAt: new Date(tomorrow.getTime() + 3 * 3_600_000), timezone: "Europe/London", status: "confirmed" }).returning();
    appointmentId = visit.id;
    const [clause] = await db.insert(wordingClauses).values({ organisationId: org.id, clauseKey: "roof-limitation", version: 1, purpose: "limitation", title: "Roof viewed from ground", body: "The roof was inspected from ground level only.", status: "approved", elementKey: null, approvedByUserId: people[0].id, approvedAt: new Date() }).returning();
    clauseId = clause.id;
    const created = await createSurvey({ ...surveyor, canRecordSurvey: true } as SurveyContext, jobId, { serviceLevel: "level_2" });
    if (created.kind !== "created") throw new Error(`survey ${created.kind}`);
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("supplies the case's form state, property history, data coverage, wording and an honest forecast status", async () => {
    const sources = await knowledgeSources(surveyor, { message: "Prepare this inspection", jobId, page: { page: "survey", resourceId: jobId }, scopedJobIds: [jobId] });
    const ids = sources.map((source) => source.id);
    expect(ids).toContain("general:professional-knowledge");
    expect(ids.some((id) => id.startsWith("form:"))).toBe(true);
    expect(ids).toContain(`history:${propertyId}`);
    expect(ids).toContain(`property-intel:${propertyId}:location`);
    expect(ids).toContain(`wording:${clauseId}`);
    const form = sources.find((source) => source.id.startsWith("form:"))!.data as { completion: { ready: boolean; outstanding: unknown[] }; sections: unknown[] };
    expect(form.completion.ready).toBe(false);
    expect(form.completion.outstanding.length).toBeGreaterThan(0);
    expect(form.sections.length).toBeGreaterThan(0);
    // No weather connection is configured: SurvAI is told so rather than receiving an invented forecast.
    expect(sources.find((source) => source.id === `forecast:${appointmentId}`)?.data).toMatchObject({ forecastStatus: "not_configured" });
  });

  it("keeps another surveyor's case and property out of reach, even when named in the question", async () => {
    const own = await knowledgeSources(otherSurveyor, { message: "Prepare this inspection", jobId, page: { page: "job", resourceId: jobId }, scopedJobIds: [] });
    // Only practice-wide knowledge (general guidance, the approved wording library) remains; nothing from the case.
    expect(own.every((source) => source.id === "general:professional-knowledge" || source.id.startsWith("wording:"))).toBe(true);
    expect(JSON.stringify(own)).not.toContain(propertyId);
    const searched = await knowledgeSources(otherSurveyor, { message: "What is the history of 12 Fictional Fields, BS9 9ZZ?", page: { page: "overview" }, scopedJobIds: [otherJobId] });
    expect(searched.some((source) => source.id.includes(propertyId))).toBe(false);
  });

  it("finds a permitted property named by postcode and returns its history", async () => {
    const sources = await knowledgeSources(manager, { message: "Pull up the history for BS9 9ZZ", page: { page: "overview" }, scopedJobIds: [jobId, otherJobId] });
    expect(sources.map((source) => source.id)).toEqual(expect.arrayContaining([`property-match:${propertyId}`, `history:${propertyId}`]));
  });

  it("re-authorises saved citations only while the user can still reach them", async () => {
    const cited = [`history:${propertyId}`, `form:00000000-0000-4000-8000-000000000001`, `forecast:${appointmentId}`, `wording:${clauseId}`, "general:professional-knowledge", "public:postcode:BS99ZZ", "unknown:thing"];
    const forSurveyor = await authorisedKnowledgeIds(surveyor, cited);
    expect([...forSurveyor].sort()).toEqual([`forecast:${appointmentId}`, "general:professional-knowledge", `history:${propertyId}`, "public:postcode:BS99ZZ", `wording:${clauseId}`].sort());
    const forOther = await authorisedKnowledgeIds(otherSurveyor, cited);
    expect(forOther.has(`history:${propertyId}`)).toBe(false);
    expect(forOther.has(`forecast:${appointmentId}`)).toBe(false);
  });
});
