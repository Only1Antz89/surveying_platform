import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clientContacts, clients, customerQuotes, dataSubjectRequests, featureUsageDaily, jobRetentionHolds, jobs, organisationMemberships, organisations, properties, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { completeAccessRequest, completeErasureRequest, ERASED, listRequests, openRequest, refuseRequest } from "../src/lib/data-protection";
import { featureAdoption, recordFeatureUse } from "../src/lib/feature-usage";

describe.skipIf(!integrationEnabled)("data protection requests and feature usage", () => {
  let database: TestDatabase, db: Database;
  let org = "", heldJob = "", ownerUser = "";
  type Ctx = { organisationId: string; internalUserId: string; role: "owner" | "manager" };
  let owner: Ctx, manager: Ctx;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [o] = await db.insert(organisations).values({ clerkOrganisationId: "org_priv", slug: "priv", name: "Privacy practice", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    org = o.id;
    const people = await db.insert(users).values([{ clerkUserId: "u_priv_o", email: "o@priv.test" }, { clerkUserId: "u_priv_m", email: "m@priv.test" }]).returning();
    ownerUser = people[0].id;
    await db.insert(organisationMemberships).values([{ organisationId: org, userId: people[0].id, role: "owner" }, { organisationId: org, userId: people[1].id, role: "manager" }]);
    owner = { organisationId: org, internalUserId: people[0].id, role: "owner" }; manager = { organisationId: org, internalUserId: people[1].id, role: "manager" };
    const [subject, other] = await db.insert(clients).values([{ organisationId: org, kind: "individual", displayName: "Pat Subject", email: "Pat@Example.test", phone: "07700 900000" }, { organisationId: org, kind: "individual", displayName: "Held Person", email: "held@example.test" }]).returning();
    await db.insert(clientContacts).values({ organisationId: org, clientId: subject.id, name: "Pat Subject", email: "pat@example.test" });
    const [property] = await db.insert(properties).values({ organisationId: org, clientId: subject.id, line1: "7 Privacy Place", city: "Bristol", postcode: "BS7 7ZZ", country: "ENG" }).returning();
    await db.insert(jobs).values({ organisationId: org, clientId: subject.id, propertyId: property.id, reference: "P-1", serviceName: "Level 2", stage: "issued" });
    const [held] = await db.insert(jobs).values({ organisationId: org, clientId: other.id, propertyId: property.id, reference: "P-2", serviceName: "Level 2", stage: "issued" }).returning();
    heldJob = held.id;
    await db.insert(customerQuotes).values({ organisationId: org, reference: "Q-P1", status: "issued", firstName: "Pat", lastName: "Subject", email: "pat@example.test", subtotalMinor: 1, vatMinor: 0, totalMinor: 1, depositMinor: 0, accessTokenHash: "hash-not-exported", expiresAt: new Date(Date.now() + 86_400_000) });
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("records an access request with a one-month deadline and exports what is held, without secrets", async () => {
    await expect(openRequest(manager, { subjectEmail: "pat@example.test", kind: "access" })).rejects.toMatchObject({ status: 403 });
    const opened = await openRequest(owner, { subjectEmail: "pat@example.test", kind: "access", notes: "Emailed in; identity checked" });
    expect(opened.held).toMatchObject({ clients: 1, contacts: 1, quotes: 1, jobs: 1, properties: 1, legalHolds: 0 });
    expect(new Date(opened.request.dueAt).getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    const bundle = await completeAccessRequest(owner, opened.request.id);
    expect(bundle.clients[0]).toMatchObject({ displayName: "Pat Subject", email: "Pat@Example.test" });
    expect(JSON.stringify(bundle)).not.toContain("hash-not-exported");
    await expect(completeAccessRequest(owner, opened.request.id)).rejects.toMatchObject({ code: "closed" });
  });
  it("erases contact details, lists what is kept, and refuses while a legal hold applies", async () => {
    const request = (await openRequest(owner, { subjectEmail: "pat@example.test", kind: "erasure" })).request;
    const result = await completeErasureRequest(owner, request.id);
    expect(result.outcome.erased).toMatchObject({ clients: 1, contacts: 1, quotes: 1 });
    expect(result.outcome.retained.join(" ")).toContain("survey record");
    const [client] = await db.select().from(clients).where(eq(clients.displayName, ERASED));
    expect(client).toMatchObject({ email: null, phone: null });
    const [quote] = await db.select().from(customerQuotes).where(eq(customerQuotes.reference, "Q-P1"));
    expect(quote).toMatchObject({ email: null, firstName: null });
    await db.insert(jobRetentionHolds).values({ organisationId: org, jobId: heldJob, kind: "complaint", reason: "Client complaint under investigation.", reviewedByUserId: ownerUser });
    const blocked = (await openRequest(owner, { subjectEmail: "held@example.test", kind: "erasure" })).request;
    await expect(completeErasureRequest(owner, blocked.id)).rejects.toMatchObject({ code: "legal_hold" });
    const refused = await refuseRequest(owner, blocked.id, "Complaint investigation requires these records.");
    expect(refused.status).toBe("refused");
    expect((await listRequests(owner)).map((item) => item.status).sort()).toEqual(["completed", "completed", "refused"]);
    expect(await db.select().from(dataSubjectRequests)).toHaveLength(3);
  });
  it("counts feature use per practice per day and reports adoption", async () => {
    await recordFeatureUse(org, "jobs"); await recordFeatureUse(org, "jobs"); await recordFeatureUse(org, "finance"); await recordFeatureUse(org, "Not A Key!");
    const rows = await db.select().from(featureUsageDaily);
    expect(rows.find((row) => row.feature === "jobs")?.count).toBe(2);
    expect(rows).toHaveLength(2);
    const adoption = await featureAdoption(30);
    expect(adoption.features[0]).toMatchObject({ feature: "jobs", practices: 1, uses: 2, label: "Jobs" });
  });
});
