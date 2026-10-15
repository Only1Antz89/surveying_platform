import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clients, createDatabase, jobs, mobileCaptureOperations, organisationMemberships, organisations, properties, surveyRooms, surveys, users, withTenant, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { createSurvey, type SurveyContext } from "../src/lib/surveys";
import { addRoom, listRooms, removeRoom, updateRoom } from "../src/lib/floor-plans";
import { currentReportInput } from "../src/lib/reports";

describe.skipIf(!integrationEnabled)("survey floor plans", () => {
  let database: TestDatabase, db: Database;
  let surveyor: SurveyContext, other: SurveyContext, foreign: SurveyContext;
  let surveyId = "";
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [org, otherOrg] = await db.insert(organisations).values([{ clerkOrganisationId: "org_fp", slug: "fp", name: "Plans practice", practiceType: "building_surveying", region: "Bristol", status: "active" }, { clerkOrganisationId: "org_fp2", slug: "fp2", name: "Other practice", practiceType: "building_surveying", region: "Bath", status: "active" }]).returning();
    const people = await db.insert(users).values([{ clerkUserId: "u_fp_s", email: "s@fp.test" }, { clerkUserId: "u_fp_o", email: "o@fp.test" }, { clerkUserId: "u_fp_f", email: "f@fp.test" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org.id, userId: people[0].id, role: "surveyor", canRecordSurvey: true }, { organisationId: org.id, userId: people[1].id, role: "surveyor", canRecordSurvey: true }, { organisationId: otherOrg.id, userId: people[2].id, role: "owner", canRecordSurvey: true }]);
    surveyor = { organisationId: org.id, internalUserId: people[0].id, role: "surveyor", canRecordSurvey: true };
    other = { organisationId: org.id, internalUserId: people[1].id, role: "surveyor", canRecordSurvey: true };
    foreign = { organisationId: otherOrg.id, internalUserId: people[2].id, role: "owner", canRecordSurvey: true };
    const [client] = await db.insert(clients).values({ organisationId: org.id, kind: "individual", displayName: "Fictional Client" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: org.id, clientId: client.id, line1: "1 Plan Street", city: "Bristol", postcode: "BS1 1ZZ", country: "ENG" }).returning();
    const [job] = await db.insert(jobs).values({ organisationId: org.id, clientId: client.id, propertyId: property.id, reference: "FP-1", serviceName: "Level 2 Home Survey", stage: "scheduled", assignedSurveyorId: people[0].id }).returning();
    const created = await createSurvey(surveyor, job.id, { serviceLevel: "level_2" });
    if (created.kind !== "created") throw new Error(`survey ${created.kind}`);
    surveyId = created.survey.id;
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("lets the assigned surveyor record, edit and remove rooms with version checks", async () => {
    const hall = await addRoom(surveyor, surveyId, { floor: "ground", name: "Hall", lengthM: 5.2, widthM: 1.8 });
    const kitchen = await addRoom(surveyor, surveyId, { floor: "ground", name: "Kitchen", lengthM: 4.8, widthM: 2.7 });
    expect(kitchen.position).toBe(hall.position + 1);
    const updated = await updateRoom(surveyor, surveyId, hall.id, hall.version, { floor: "ground", name: "Entrance hall", lengthM: 5.25, widthM: 1.8, notes: "To the stairs" });
    expect(updated).toMatchObject({ name: "Entrance hall", lengthM: 5.25, version: 2 });
    await expect(updateRoom(surveyor, surveyId, hall.id, hall.version, { floor: "ground", name: "Stale" })).rejects.toMatchObject({ status: 409 });
    await removeRoom(surveyor, surveyId, kitchen.id);
    expect((await listRooms(surveyor, surveyId))!.map((room) => room.name)).toEqual(["Entrance hall"]);
  });
  it("keeps rooms away from unassigned surveyors, other practices and people without recording permission", async () => {
    expect(await listRooms(other, surveyId)).toBeNull();
    await expect(addRoom(other, surveyId, { floor: "ground", name: "Sneaky" })).rejects.toMatchObject({ status: 404 });
    expect(await listRooms(foreign, surveyId)).toBeNull();
    await expect(addRoom({ ...surveyor, role: "manager", canRecordSurvey: false }, surveyId, { floor: "ground", name: "Nope" })).rejects.toMatchObject({ status: 403 });
    expect(await withTenant(createDatabase(), foreign.organisationId, (tx) => tx.select().from(surveyRooms))).toEqual([]);
  });
  it("replays mobile room creates once and still checks current access", async () => {
    const body = { floor: "ground" as const, name: "Retry room", lengthM: 2, widthM: 3 };
    const [first, second] = await Promise.all([addRoom(surveyor, surveyId, body, "q_retry_room_1"), addRoom(surveyor, surveyId, body, "q_retry_room_1")]);
    expect(second.id).toBe(first.id);
    expect(await withTenant(createDatabase(), foreign.organisationId, tx => tx.select().from(mobileCaptureOperations))).toEqual([]);
    expect((await listRooms(surveyor, surveyId))!.filter(room => room.name === body.name)).toHaveLength(1);
    await expect(addRoom(surveyor, surveyId, {...body, name: "Changed"}, "q_retry_room_1")).rejects.toMatchObject({status:409});
    await expect(addRoom(other, surveyId, body, "q_retry_room_1")).rejects.toMatchObject({status:404});
    await expect(addRoom(foreign, surveyId, body, "q_retry_room_1")).rejects.toMatchObject({status:404});
    await removeRoom(surveyor, surveyId, first.id);
    expect((await addRoom(surveyor, surveyId, body, "q_retry_room_1")).id).toBe(first.id);
    expect((await listRooms(surveyor, surveyId))!.filter(room => room.name === body.name)).toHaveLength(0);
  });
  it("marks a composed report out of date when measurements change, and locks rooms after sign-off", async () => {
    const before = await withTenant(createDatabase(), surveyor.organisationId, (tx) => currentReportInput(tx, surveyor, surveyId));
    await addRoom(surveyor, surveyId, { floor: "first", name: "Bedroom", lengthM: 4, widthM: 3 });
    const after = await withTenant(createDatabase(), surveyor.organisationId, (tx) => currentReportInput(tx, surveyor, surveyId));
    expect(after!.fingerprint).not.toBe(before!.fingerprint);
    expect(after!.rooms).toHaveLength(2);
    await db.update(surveys).set({ status: "approved" }).where(eq(surveys.id, surveyId));
    await expect(addRoom(surveyor, surveyId, { floor: "ground", name: "Late" })).rejects.toMatchObject({ status: 409 });
  });
});
