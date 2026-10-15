import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mobileContext } from "../src/lib/mobile-access";
import { entitlements, organisationOperationalSettings, clients, jobs, organisationMemberships, organisations, properties, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
const mobileAuth=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock("@clerk/nextjs/server",()=>({verifyToken:mobileAuth.verify}));
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
  it("returns the original expense on sequential and concurrent mobile retries", async () => {
    const body = { kind: "expense" as const, occurredOn: today, amountMinor: 3000, category: "travel" as const, description: "Lost-response retry" };
    const results=await Promise.all([addCostEntry(surveyor,jobId,body,"q_retry_cost_1"),addCostEntry(surveyor,jobId,body,"q_retry_cost_1")]);
    const replay=await addCostEntry(surveyor,jobId,body,"q_retry_cost_1");
    const managerCopy=await addCostEntry(manager,jobId,body,"q_retry_cost_1");
    expect(managerCopy.id).not.toBe(results[0].id);
    await removeCostEntry(manager,jobId,managerCopy.id);
    expect(results[0].id).toBe(results[1].id);expect(replay.id).toBe(results[0].id);
    expect((await jobCosts(manager,jobId))!.entries.filter(entry=>entry.description===body.description)).toHaveLength(1);
    await expect(addCostEntry(surveyor,jobId,{...body,amountMinor:4000},"q_retry_cost_1")).rejects.toMatchObject({status:409});
    await expect(addCostEntry(other,jobId,body,"q_retry_cost_1")).rejects.toMatchObject({status:404});
    await removeCostEntry(surveyor,jobId,replay.id);
    expect((await addCostEntry(surveyor,jobId,body,"q_retry_cost_1")).id).toBe(replay.id);
    expect((await jobCosts(manager,jobId))!.entries.filter(entry=>entry.description===body.description)).toHaveLength(0);
  });
  it("enforces the practice policy using a separately verified matching session", async () => {
    vi.stubEnv("CLERK_SECRET_KEY","synthetic-test-only");
    await db.update(organisationMemberships).set({canRecordSurvey:true}).where(eq(organisationMemberships.userId,surveyor.internalUserId));
    await db.insert(entitlements).values({organisationId:surveyor.organisationId,key:"billing_exempt",enabled:true});
    await db.insert(organisationOperationalSettings).values({organisationId:surveyor.organisationId,requireTwoStep:true});
    const primary={sub:"u_c_s",org_id:"org_costs"};
    mobileAuth.verify.mockImplementation(async(token:string)=>token==="mobile"?primary:{sub:"u_c_s",v:2,o:{id:"org_costs"},sid:"sess_test",fva:[0,0]});
    const request=(session?:string)=>new Request("https://synthetic.test/api/mobile/jobs",{headers:{authorization:"Bearer mobile",...(session?{"x-surveynt-session-token":session}:{})}});
    expect(await mobileContext(request())).toBeNull();
    expect(await mobileContext(request("session"))).toMatchObject({userId:surveyor.internalUserId});
    for(const session of [{...primary},{...primary,sid:"sess_test",fva:[0,-1]},{...primary,sub:"wrong",sid:"sess_test",fva:[0,0]},{...primary,org_id:"wrong",sid:"sess_test",fva:[0,0]}]){
      mobileAuth.verify.mockImplementation(async(token:string)=>token==="mobile"?primary:session);
      expect(await mobileContext(request("session"))).toBeNull();
    }
    mobileAuth.verify.mockImplementation(async(token:string)=>{if(token==="mobile")return primary;throw new Error("Invalid signature");});
    expect(await mobileContext(request("invalid"))).toBeNull();
    await db.update(organisationOperationalSettings).set({requireTwoStep:false}).where(eq(organisationOperationalSettings.organisationId,surveyor.organisationId));
    expect(await mobileContext(request())).toMatchObject({userId:surveyor.internalUserId});
    await db.update(organisationMemberships).set({active:false}).where(eq(organisationMemberships.userId,surveyor.internalUserId));
    expect(await mobileContext(request())).toBeNull();
  });
});
