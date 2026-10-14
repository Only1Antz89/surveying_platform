import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { appointments, backgroundJobs, clientMessages, clients, invoiceLineItems, invoices, jobStageEvents, jobs, organisationMemberships, organisations, properties, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { listTemplates, queueScheduledClientMessages, saveReviewSettings, saveTemplate, sendJobMessage } from "../src/lib/client-messages";
import { createReferralSource, referralReport, setJobReferral, setReferralSourceActive } from "../src/lib/referrals";
import { accountingExport } from "../src/lib/accounting-export";

describe.skipIf(!integrationEnabled)("client messages, referrals and accounting export", () => {
  let database: TestDatabase, db: Database;
  let org = "", jobId = "", noEmailJob = "";
  type Ctx = { organisationId: string; internalUserId: string; role: "manager" | "surveyor" };
  let manager: Ctx, surveyor: Ctx;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_APP_URL", database.appUrl); vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    const [o] = await db.insert(organisations).values({ clerkOrganisationId: "org_crm", slug: "crm", name: "CRM practice", practiceType: "building_surveying", region: "Bristol", status: "active" }).returning();
    org = o.id;
    const people = await db.insert(users).values([{ clerkUserId: "u_crm_m", email: "m@crm.test" }, { clerkUserId: "u_crm_s", email: "s@crm.test", firstName: "Sasha", lastName: "Surveyor" }]).returning();
    await db.insert(organisationMemberships).values([{ organisationId: org, userId: people[0].id, role: "manager" }, { organisationId: org, userId: people[1].id, role: "surveyor" }]);
    manager = { organisationId: org, internalUserId: people[0].id, role: "manager" }; surveyor = { organisationId: org, internalUserId: people[1].id, role: "surveyor" };
    const [client, quiet] = await db.insert(clients).values([{ organisationId: org, kind: "individual", displayName: "Alex Client", email: "alex@example.test" }, { organisationId: org, kind: "individual", displayName: "No Email" }]).returning();
    const [property] = await db.insert(properties).values({ organisationId: org, clientId: client.id, line1: "6 Message Mews", city: "Bristol", postcode: "BS6 6ZZ", country: "ENG" }).returning();
    const created = await db.insert(jobs).values([{ organisationId: org, clientId: client.id, propertyId: property.id, reference: "M-1", serviceName: "Level 2", stage: "scheduled", assignedSurveyorId: people[1].id, fee: "800.00" }, { organisationId: org, clientId: quiet.id, propertyId: property.id, reference: "M-2", serviceName: "Level 3", stage: "scheduled", fee: "1200.00" }]).returning();
    jobId = created[0].id; noEmailJob = created[1].id;
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });

  it("sends manual messages only when switched on, once a day, and records skips", async () => {
    await expect(sendJobMessage(surveyor, jobId, "on_the_way")).rejects.toMatchObject({ code: "template_off" });
    await saveTemplate(manager, { key: "on_the_way", channel: "email", subject: "On the way · {reference}", body: "Dear {clientName}, {surveyorName} is on the way to {propertyAddress}.", enabled: true });
    await saveTemplate(manager, { key: "on_the_way", channel: "sms", body: "{surveyorName} is on the way.", enabled: false });
    await expect(saveTemplate(manager, { key: "on_the_way", channel: "sms", body: "{surveyorName} is on the way.", enabled: true })).rejects.toMatchObject({ code: "sms_not_connected" });
    const results = await sendJobMessage(surveyor, jobId, "on_the_way");
    expect(results).toEqual([{ channel: "email", status: "queued", reason: null }]);
    const [queued] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.type, "client_message"));
    expect(queued.payload).toMatchObject({ recipients: ["alex@example.test"], subject: "On the way · M-1" });
    expect(String(queued.payload.body)).toContain("Sasha Surveyor is on the way to 6 Message Mews, Bristol, BS6 6ZZ");
    await expect(sendJobMessage(surveyor, jobId, "on_the_way")).rejects.toMatchObject({ code: "already_sent" });
    await expect(sendJobMessage(surveyor, noEmailJob, "on_the_way")).rejects.toMatchObject({ status: 404 });
    expect((await sendJobMessage(manager, noEmailJob, "on_the_way"))[0]).toMatchObject({ status: "skipped", reason: "The client has no email address." });
    expect((await listTemplates(manager)).templates.find((item) => item.key === "on_the_way" && item.channel === "email")?.customised).toBe(true);
  });
  it("queues tomorrow's reminders and post-issue review requests from the daily run, without duplicates", async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 26 * 3_600_000);
    await db.insert(appointments).values({ organisationId: org, jobId, startsAt: tomorrow, endsAt: new Date(tomorrow.getTime() + 3 * 3_600_000), timezone: "Europe/London", status: "confirmed" });
    await saveTemplate(manager, { key: "appointment_reminder", channel: "email", subject: "Reminder · {reference}", body: "Your visit is on {appointmentDate} at {appointmentTime}.", enabled: true });
    await saveTemplate(manager, { key: "review_request", channel: "email", subject: "How did we do? · {reference}", body: "Please leave a review for {practiceName}.", enabled: true });
    await expect(saveReviewSettings(manager, { enabled: true, reviewUrl: null, delayDays: 2 })).rejects.toMatchObject({ code: "review_url_required" });
    await saveReviewSettings(manager, { enabled: true, reviewUrl: "https://example.com/review", delayDays: 2 });
    await db.insert(jobStageEvents).values({ organisationId: org, jobId: noEmailJob, fromStage: "internal_review", toStage: "issued", createdAt: new Date(now.getTime() - 3 * 86_400_000) });
    await db.insert(jobStageEvents).values({ organisationId: org, jobId, fromStage: "internal_review", toStage: "issued", createdAt: new Date(now.getTime() - 3 * 86_400_000) });
    const first = await queueScheduledClientMessages(now);
    const expectedReminders = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(tomorrow) === new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(now.getTime() + 86_400_000)) ? 1 : 0;
    expect(first).toEqual({ reminders: expectedReminders, reviews: 1 });
    expect(await queueScheduledClientMessages(now)).toEqual({ reminders: 0, reviews: 0 });
    const skipped = await db.select().from(clientMessages).where(eq(clientMessages.jobId, noEmailJob));
    expect(skipped.some((row) => row.templateKey === "review_request" && row.status === "skipped")).toBe(true);
  });
  it("tags jobs with active referral sources and reports instructions by source", async () => {
    const agent = await createReferralSource(manager, { name: "Fictional Agents", kind: "estate_agent" });
    await expect(createReferralSource(manager, { name: "fictional agents", kind: "other" })).rejects.toMatchObject({ code: "duplicate" });
    await expect(setJobReferral(surveyor, jobId, agent.id)).rejects.toMatchObject({ status: 403 });
    await setJobReferral(manager, jobId, agent.id);
    const report = await referralReport(manager);
    expect(report.report[0]).toMatchObject({ jobs: 1, feesMinor: 80000 });
    expect(report.untracked.jobs).toBe(1);
    await setReferralSourceActive(manager, agent.id, false);
    await expect(setJobReferral(manager, noEmailJob, agent.id)).rejects.toMatchObject({ code: "invalid_source" });
  });
  it("exports issued invoices with their line items for Xero", async () => {
    const [invoice] = await db.insert(invoices).values({ organisationId: org, jobId, number: "INV-1", status: "open", subtotalMinor: 80000, vatMinor: 16000, totalMinor: 96000, issuedAt: new Date("2026-10-01T10:00:00Z"), dueAt: new Date("2026-10-15T10:00:00Z") }).returning();
    await db.insert(invoiceLineItems).values({ organisationId: org, invoiceId: invoice.id, description: "Level 2 Home Survey", quantity: 1, unitAmountMinor: 80000 });
    await db.insert(invoices).values({ organisationId: org, jobId: noEmailJob, number: "INV-DRAFT", status: "draft", subtotalMinor: 1, vatMinor: 0, totalMinor: 1 });
    const result = await accountingExport(org, "xero", {});
    expect(result.invoices).toBe(1);
    expect(result.csv).toContain('"Alex Client","alex@example.test","INV-1","M-1","01/10/2026","15/10/2026","Level 2 Home Survey","1","800.00","200","20% (VAT on Income)","GBP"');
    expect(result.csv).not.toContain("INV-DRAFT");
  });
});
