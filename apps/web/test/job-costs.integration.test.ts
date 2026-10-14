import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clients, jobs, organisationMemberships, organisations, properties, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { addCostEntry, jobCosts, practiceProfitability, removeCostEntry } from "../src/lib/job-costs";

describe.skipIf(!integrationEnabled)("job time and costs", () => {
  let database: TestDatabase, db: Database;
  let jobId = "";
  type Ctx = { organisationId: string; internalUserId: string; role: "manager" | "surveyor" | "finance" };
  let manager: Ctx, surveyor: Ctx, other: Ctx, finance: Ctx;
  const today = new Date().toISOString().slice(0, 10);
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [org] = await db.insert(organisations).values({ clerkOrganisationId: "org_costs", slug: "costs", name: "Costs practice", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    const people = await db.insert(users).values([{ clerkUserId: "u_c_m", email: "m@c.test", firstName: "Mia" }, { clerkUserId: "u_c_s", email: "s@c.test", firstName: "Sam" }, { clerkUserId: "u_c_o", email: "o@c.test" }, { clerkUserId: "u_c_f", email: "f@c.test" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org.id, userId: people[0].id, role: "manager" }, { organisationId: org.id, userId: people[1].id, role: "surveyor" }, { organisationId: org.id, userId: people[2].id, role: "surveyor" }, { organisationId: org.id, userId: people[3].id, role: "finance" }]);
    [manager, surveyor, other, finance] = (["manager", "surveyor", "surveyor", "finance"] as const).map((role, index) => ({ organisationId: org.id, internalUserId: people[index].id, role }));
    const [client] = await db.insert(clients).values({ organisationId: org.id, kind: "individual", displayName: "Fictional Client" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: org.id, clientId: client.id, line1: "5 Cost Close", city: "Bristol", postcode: "BS5 5ZZ", country: "ENG" }).returning();
    const [job] = await db.insert(jobs).values({ organisationId: org.id, clientId: client.id, propertyId: property.id, reference: "C-1", serviceName: "Level 3", stage: "report_drafting", assignedSurveyorId: people[1].id, fee: "1000.00" }).returning();
    jobId = job.id;
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("lets the assigned surveyor record their own costs without seeing the fee or profit", async () => {
    await addCostEntry(surveyor, jobId, { kind: "time", occurredOn: today, minutes: 240 });
    await addCostEntry(surveyor, jobId, { kind: "mileage", occurredOn: today, miles: 20 });
    await addCostEntry(manager, jobId, { kind: "expense", occurredOn: today, amountMinor: 1500, category: "parking" });
    const own = await jobCosts(surveyor, jobId);
    expect(own!.showsMoney).toBe(false);
    expect(own!.entries).toHaveLength(2);
    expect(own!.summary).toMatchObject({ feeMinor: null, profitMinor: null, timeCostMinor: 0 });
    await expect(addCostEntry(other, jobId, { kind: "time", occurredOn: today, minutes: 30 })).rejects.toMatchObject({ status: 404 });
    await expect(addCostEntry(finance, jobId, { kind: "time", occurredOn: today, minutes: 30 })).rejects.toMatchObject({ status: 403 });
  });
  it("shows management the full picture and profitability, and only lets people remove their own entries", async () => {
    const full = await jobCosts(manager, jobId);
    expect(full!.summary).toMatchObject({ minutes: 240, miles: 20, timeCostMinor: 14000, mileageCostMinor: 900, expensesMinor: 1500, feeMinor: 100000, profitMinor: 83600 });
    const expense = full!.entries.find((entry) => entry.kind === "expense")!;
    await expect(removeCostEntry(surveyor, jobId, expense.id)).rejects.toMatchObject({ status: 404 });
    const report = await practiceProfitability(finance);
    expect(report.rows[0]).toMatchObject({ reference: "C-1", profitMinor: 83600 });
    expect(report.services[0]).toMatchObject({ service: "Level 3", jobs: 1 });
    await expect(practiceProfitability(surveyor)).rejects.toMatchObject({ status: 403 });
    await removeCostEntry(manager, jobId, expense.id);
    expect((await jobCosts(manager, jobId))!.entries).toHaveLength(2);
  });
});
