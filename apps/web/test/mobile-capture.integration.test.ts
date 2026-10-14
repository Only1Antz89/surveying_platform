import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clients, jobs, organisationMemberships, organisations, properties, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { mobileCapture, surveyContextFor, type MobileContext } from "../src/lib/mobile-capture";
import { applySyncOperations, createSurvey } from "../src/lib/surveys";
import { addRoom } from "../src/lib/floor-plans";

describe.skipIf(!integrationEnabled)("mobile site capture", () => {
  let database: TestDatabase, db: Database;
  let jobId = "", surveyId = "", unstarted = "";
  let surveyor: MobileContext, other: MobileContext;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [org] = await db.insert(organisations).values({ clerkOrganisationId: "org_mob", slug: "mob", name: "Mobile practice", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    const people = await db.insert(users).values([{ clerkUserId: "u_mob_s", email: "s@mob.test" }, { clerkUserId: "u_mob_o", email: "o@mob.test" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org.id, userId: people[0].id, role: "surveyor" }, { organisationId: org.id, userId: people[1].id, role: "surveyor" }]);
    surveyor = { organisationId: org.id, userId: people[0].id, role: "surveyor" }; other = { organisationId: org.id, userId: people[1].id, role: "surveyor" };
    const [client] = await db.insert(clients).values({ organisationId: org.id, kind: "individual", displayName: "Fictional Client" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: org.id, clientId: client.id, line1: "8 Field Lane", city: "Bristol", postcode: "BS8 8ZZ", country: "ENG" }).returning();
    const created = await db.insert(jobs).values([{ organisationId: org.id, clientId: client.id, propertyId: property.id, reference: "F-1", serviceName: "Level 2", stage: "scheduled", assignedSurveyorId: people[0].id }, { organisationId: org.id, clientId: client.id, propertyId: property.id, reference: "F-2", serviceName: "Level 2", stage: "scheduled", assignedSurveyorId: people[0].id }]).returning();
    jobId = created[0].id; unstarted = created[1].id;
    const survey = await createSurvey(surveyContextFor(surveyor), jobId, { serviceLevel: "level_2" });
    if (survey.kind !== "created") throw new Error(survey.kind);
    surveyId = survey.survey.id;
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("gives the assigned surveyor the survey outline and nobody else", async () => {
    const capture = await mobileCapture(surveyor, jobId);
    expect(capture?.survey).toMatchObject({ id: surveyId, editable: true });
    expect(capture?.sections?.length).toBeGreaterThan(3);
    expect(capture?.sections?.[0].elements[0]).toMatchObject({ inspectionStatus: null, photos: 0 });
    expect(await mobileCapture(other, jobId)).toBeNull();
    expect((await mobileCapture(surveyor, unstarted))?.survey).toBeNull();
  });
  it("applies queued status changes and site notes idempotently, and shows rooms", async () => {
    const outline = (await mobileCapture(surveyor, jobId))!;
    const section = outline.sections![0], element = section.elements[0];
    const operations = [
      { type: "set_element" as const, operationId: "op_mobile_0001", element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, inspectionStatus: "inaccessible" as const, limitationReason: "Loft hatch painted shut", baseVersion: null },
      { type: "add_observation" as const, operationId: "op_mobile_0002", element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, kind: "current_observation" as const, text: "Hairline crack above the hatch." },
    ];
    const first = await applySyncOperations(surveyContextFor(surveyor), surveyId, operations);
    expect(first.map((result) => result.status)).toEqual(["applied", "applied"]);
    const retry = await applySyncOperations(surveyContextFor(surveyor), surveyId, operations);
    expect(retry.map((result) => result.status)).toEqual(["duplicate", "duplicate"]);
    await addRoom(surveyContextFor(surveyor), surveyId, { floor: "ground", name: "Kitchen", lengthM: 4.2, widthM: 3 });
    const after = (await mobileCapture(surveyor, jobId))!;
    expect(after.sections![0].elements[0]).toMatchObject({ inspectionStatus: "inaccessible", limitationReason: "Loft hatch painted shut" });
    expect(after.rooms).toHaveLength(1);
    const rejected = await applySyncOperations(surveyContextFor(other), surveyId, [{ ...operations[1], operationId: "op_mobile_0003" }]);
    expect(rejected[0].status).toBe("rejected");
  });
});
