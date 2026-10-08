import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, clients, jobs, organisationMemberships, organisations, properties, users, withTenant } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import type { OrganisationRole } from "@surveynt/domain";

const state = vi.hoisted(() => ({ context: { organisationId: "", internalUserId: "", userId: "test", clerkOrganisationId: "test", role: "owner" as OrganisationRole, canRecordSurvey: false, canApproveReports: false, demo: false, accessLevel: "full" } }));
vi.mock("../src/lib/access", () => ({ apiContext: async () => state.context, canWriteWorkspace: () => true }));
import { PATCH as permissionChange } from "../src/app/api/v1/team/[id]/permissions/route";
import { GET as getJobs } from "../src/app/api/v1/jobs/route";
import { GET as getProperties } from "../src/app/api/v1/properties/route";
import { GET as getSurvey } from "../src/app/api/v1/jobs/[id]/survey/route";
import { createSurvey } from "../src/lib/surveys";

describe.skipIf(!integrationEnabled)("professional grants and assigned records", () => {
  let database: TestDatabase;
  const org = crypto.randomUUID(), owner = crypto.randomUUID(), surveyor = crypto.randomUUID(), manager = crypto.randomUUID();
  const ownerMembership = crypto.randomUUID(), managerMembership = crypto.randomUUID();
  const jobA = crypto.randomUUID(), jobB = crypto.randomUUID(), propertyA = crypto.randomUUID(), propertyB = crypto.randomUUID();
  const request = (path: string, body?: unknown) => new Request(`https://example.test/api/v1/${path}`, body ? { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_APP_URL = database.appUrl;
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values({ id: org, clerkOrganisationId: `test_${org}`, slug: `test-${org}`, name: "Permission test", practiceType: "residential", region: "England", status: "active" });
    await admin.insert(users).values([owner, surveyor, manager].map(id => ({ id, clerkUserId: `test_${id}`, email: `${id}@example.test` })));
    await admin.insert(organisationMemberships).values([{ id: ownerMembership, organisationId: org, userId: owner, role: "owner" }, { organisationId: org, userId: surveyor, role: "surveyor" }, { id: managerMembership, organisationId: org, userId: manager, role: "manager" }]);
    const client = crypto.randomUUID();
    await admin.insert(clients).values({ id: client, organisationId: org, kind: "individual", displayName: "Shared customer" });
    await admin.insert(properties).values([propertyA, propertyB].map((id, index) => ({ id, organisationId: org, clientId: client, line1: `${index + 1} Fictional Road`, city: "Bristol", postcode: "BS1 1AA", country: "ENG" as const })));
    await admin.insert(jobs).values([{ id: jobA, organisationId: org, clientId: client, propertyId: propertyA, reference: "TEST-A", serviceName: "Level 2 Home Survey", assignedSurveyorId: surveyor, fee: "500" }, { id: jobB, organisationId: org, clientId: client, propertyId: propertyB, reference: "TEST-B", serviceName: "Level 3 Building Survey", assignedSurveyorId: owner, fee: "900" }]);
    Object.assign(state.context, { organisationId: org, internalUserId: owner });
  }, 60_000);
  afterAll(async () => { await database?.drop(); await stopRelay(); delete process.env.DATABASE_APP_URL; });

  it("requires an owner and validates audit reasons", async () => {
    state.context.role = "manager"; state.context.internalUserId = manager;
    expect((await permissionChange(request(`team/${managerMembership}/permissions`, { permission: "record_survey", enabled: true, reason: "Self grant attempt" }), { params: Promise.resolve({ id: managerMembership }) })).status).toBe(403);
    state.context.role = "owner"; state.context.internalUserId = owner;
    expect((await permissionChange(request(`team/${ownerMembership}/permissions`, { permission: "record_survey", enabled: true, reason: "x" }), { params: Promise.resolve({ id: ownerMembership }) })).status).toBe(400);
  });
  it("persists separate grants and immutable audit evidence, then revokes", async () => {
    const response = await permissionChange(request(`team/${managerMembership}/permissions`, { permission: "record_survey", enabled: true, reason: "Approved practitioner for test practice" }), { params: Promise.resolve({ id: managerMembership }) });
    expect(response.status).toBe(200);
    const admin = database.connect(database.adminUrl);
    const [member] = await admin.select().from(organisationMemberships).where(eq(organisationMemberships.id, managerMembership));
    expect(member.canRecordSurvey).toBe(true); expect(member.canApproveReports).toBe(false);
    const audit = await admin.select().from(auditEvents).where(and(eq(auditEvents.organisationId, org), eq(auditEvents.resourceId, managerMembership)));
    expect(audit).toHaveLength(1); expect(audit[0].actorUserId).toBe(owner); expect(audit[0].metadata).toMatchObject({ permission: "record_survey", recipientUserId: manager, reason: "Approved practitioner for test practice" });
    expect((await permissionChange(request(`team/${managerMembership}/permissions`, { permission: "record_survey", enabled: false, reason: "Revoked for test scenario" }), { params: Promise.resolve({ id: managerMembership }) })).status).toBe(200);
  });
  it("filters shared-customer jobs and properties and excludes surveyor fees", async () => {
    Object.assign(state.context, { role: "surveyor", internalUserId: surveyor, canRecordSurvey: false, canApproveReports: false });
    const work = await (await getJobs(request("jobs"))).json();
    expect(work.data.map((job: { id: string }) => job.id)).toEqual([jobA]); expect(work.data[0]).not.toHaveProperty("fee");
    const buildings = await (await getProperties(request("properties"))).json();
    expect(buildings.data.map((property: { id: string }) => property.id)).toEqual([propertyA]);
    expect((await getSurvey(request(`jobs/${jobB}/survey`), { params: Promise.resolve({ id: jobB }) })).status).toBe(404);
  });
  it("creates the assigned survey exactly once under concurrent starts", async () => {
    const context = { organisationId: org, internalUserId: surveyor, role: "surveyor" as const };
    const results = await Promise.all([createSurvey(context, jobA, { serviceLevel: "level_2", jurisdiction: "ENG" }), createSurvey(context, jobA, { serviceLevel: "level_2", jurisdiction: "ENG" })]);
    expect(results.map(result => result.kind).sort()).toEqual(["created", "existing"]);
    const ids = results.map(result => result.kind === "created" || result.kind === "existing" ? result.survey.id : null);
    expect(ids[0]).toBe(ids[1]);
    const forbidden = await createSurvey(context, jobB, { serviceLevel: "level_3", jurisdiction: "ENG" });
    expect(forbidden.kind).toBe("missing");
  });
  it("retains tenant RLS for permission columns", async () => {
    const app = database.connect(database.appUrl);
    expect(await withTenant(app, crypto.randomUUID(), tx => tx.select().from(organisationMemberships).where(eq(organisationMemberships.id, ownerMembership)))).toEqual([]);
  });
  it("rejects stale grants, inactive memberships and reassigned work", async () => {
    const staleManager = { organisationId: org, internalUserId: manager, role: "manager" as const, canRecordSurvey: true };
    expect((await createSurvey(staleManager, jobB, { serviceLevel: "level_3", jurisdiction: "ENG" })).kind).toBe("invalid");
    const admin = database.connect(database.adminUrl);
    await admin.update(jobs).set({ assignedSurveyorId: owner }).where(eq(jobs.id, jobA));
    const practitioner = { organisationId: org, internalUserId: surveyor, role: "surveyor" as const };
    expect((await createSurvey(practitioner, jobA, { serviceLevel: "level_2", jurisdiction: "ENG" })).kind).toBe("missing");
    await admin.update(organisationMemberships).set({ active: false }).where(and(eq(organisationMemberships.organisationId, org), eq(organisationMemberships.userId, surveyor)));
    expect((await createSurvey(practitioner, jobA, { serviceLevel: "level_2", jurisdiction: "ENG" })).kind).toBe("invalid");
  });
});
