// Full job flow for a live (non-demo) practice with production-style
// configuration: signed quote links, Stripe Checkout and signed webhooks, and
// SMTP2GO email. Stripe and SMTP2GO are simulated at their network boundary,
// so every Surveynt code path runs as it would with real keys.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("../src/lib/access", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/lib/access")>()), apiContext: async () => session.current, canWriteWorkspace: () => true }));
const stripeState = vi.hoisted(() => ({ sessions: new Map<string, Record<string, unknown>>(), created: [] as Record<string, unknown>[] }));
vi.mock("stripe", async (importOriginal) => {
  const original = await importOriginal<typeof import("stripe")>();
  return { ...original, default: class extends original.default {
    constructor(...args: ConstructorParameters<typeof original.default>) {
      super(...args);
      // Only Checkout Session creation and lookup are simulated; webhook signing stays real.
      this.checkout.sessions.create = (async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        const existing = [...stripeState.sessions.values()].find((session) => session.idempotencyKey === options?.idempotencyKey);
        if (existing) return existing;
        const id = `cs_test_${crypto.randomUUID().replaceAll("-", "")}`;
        const lineItems = params.line_items as { price_data: { unit_amount: number; currency: string } }[];
        const session = { id, object: "checkout.session", status: "open", mode: params.mode, url: `https://checkout.stripe.test/${id}`, amount_total: lineItems[0].price_data.unit_amount, currency: lineItems[0].price_data.currency, metadata: params.metadata, idempotencyKey: options?.idempotencyKey };
        stripeState.sessions.set(id, session); stripeState.created.push(session);
        return session;
      }) as never;
      this.checkout.sessions.retrieve = (async (id: string) => stripeState.sessions.get(id)) as never;
    }
  } };
});
import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { backgroundJobs, clientPayments, createDatabase, invoices, jobs, organisationMemberships, organisationOperationalSettings, organisations, users, withTenant } from "@surveynt/db";
import { isFieldRequired, listFields, residentialTemplateV1, type FieldDefinition, type FieldValue, type SyncOperation } from "@surveynt/assistant";
import { syncSourceRegistry } from "@surveynt/property-data/importers";
import { seedStakeholderDemo } from "../src/lib/stakeholder-demo";
import { acceptQuoteAddress, createPublicQuote, readPublicQuote } from "../src/lib/firm-operations";
import { applySyncOperations, createSurvey, type SurveyContext } from "../src/lib/surveys";
import { approveReportVersion, composeSurveyReport } from "../src/lib/reports";
import { enforceStageGate } from "../src/lib/completion";
import { processEmailQueue } from "../src/lib/email-queue";
import { POST as checkout } from "../src/app/api/v1/public/quotes/[id]/checkout/route";
import { GET as slots, POST as book } from "../src/app/api/v1/public/quotes/[id]/appointments/route";
import { GET as reports } from "../src/app/api/v1/public/quotes/[id]/reports/route";
import { POST as stripeWebhook } from "../src/app/api/webhooks/stripe/route";
import { PATCH as updateJob } from "../src/app/api/v1/jobs/[id]/route";

function sample(field: FieldDefinition): FieldValue {
  switch (field.type) {
    case "enum": return { state: "provided", value: ["listed_status", "conservation_area"].includes(field.key) ? "no_record_found" : field.options![0].value };
    case "integer": case "decimal": return { state: "provided", value: field.min ?? 1 };
    case "boolean": return { state: "provided", value: false };
    case "date": return { state: "provided", value: new Date().toISOString().slice(0, 10) };
    default: return { state: "provided", value: `Simulated inspection: ${field.key.replaceAll("_", " ")}.` };
  }
}
function inspection(): SyncOperation[] {
  const operations: SyncOperation[] = []; let count = 0; const op = () => `op_live_journey_${String(++count).padStart(6, "0")}`;
  for (const section of residentialTemplateV1.sections) for (const element of section.elements) if (element.inspectable) operations.push({ type: "set_element", operationId: op(), element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, inspectionStatus: section.key === "outside" && element.key === "roof_coverings" ? "inspected" : "not_applicable", limitationReason: null, baseVersion: null });
  for (const resolved of listFields(residentialTemplateV1)) if (!resolved.element.inspectable && isFieldRequired(resolved.field, { serviceLevel: "level_1" })) operations.push({ type: "set_field", operationId: op(), fieldPath: resolved.path, value: sample(resolved.field), baseValueId: null });
  operations.push({ type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.condition_rating", value: { state: "provided", value: "2" }, baseValueId: null }, { type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.construction", value: { state: "provided", value: "Simulated: pitched natural-slate roof." }, baseValueId: null });
  return operations;
}

describe.skipIf(!integrationEnabled)("live practice journey with production-style configuration", () => {
  const webhookSecret = "whsec_live_journey_simulation";
  const signer = new Stripe("sk_test_live_journey_no_network");
  let database: TestDatabase, owner: SurveyContext, organisationId: string;
  const sentEmails: { to: string[]; subject: string }[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    for (const [name, value] of Object.entries({
      DATABASE_ADMIN_URL: database.adminUrl, DATABASE_APP_URL: database.appUrl, APP_URL: "https://app.surveynt.test", NEXT_PUBLIC_APP_URL: "https://app.surveynt.test",
      QUOTE_TOKEN_SECRET: "q".repeat(48), STRIPE_SECRET_KEY: "sk_test_live_journey_no_network", STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_CLIENT_PAYMENTS_KEY: "rk_test_live_journey_no_network", CLIENT_PAYMENTS_LAUNCH_APPROVED: "true",
      SMTP2GO_API_KEY: "api-live-journey", SMTP2GO_SENDER: "Practice <office@practice.test>",
    })) vi.stubEnv(name, value);
    const db = database.connect(database.adminUrl); await syncSourceRegistry(db);
    const [ownerUser, financeUser] = await db.insert(users).values([{ clerkUserId: "user_live_owner", email: "owner@practice.test" }, { clerkUserId: "user_live_finance", email: "finance@practice.test" }]).returning();
    // Services, pricing, availability and staff come from the demo seed; the practice is then switched to live.
    const [org] = await db.insert(organisations).values({ clerkOrganisationId: "org_live_journey", slug: "live-journey", name: "Live journey practice", practiceType: "building_surveying", region: "Bristol", status: "active", isDemo: true, demoGeneration: 1 }).returning();
    organisationId = org.id;
    await db.insert(organisationMemberships).values([{ organisationId, userId: ownerUser.id, role: "owner", active: true, canRecordSurvey: true, canApproveReports: true }, { organisationId, userId: financeUser.id, role: "finance", active: true }]);
    await seedStakeholderDemo(organisationId, ownerUser.id, db);
    await db.update(organisations).set({ isDemo: false }).where(eq(organisations.id, organisationId));
    await db.update(organisationOperationalSettings).set({ publicQuotesEnabled: true, clientPaymentsEnabled: true }).where(eq(organisationOperationalSettings.organisationId, organisationId));
    owner = { organisationId, internalUserId: ownerUser.id, role: "owner", canRecordSurvey: true, canApproveReports: true };
    session.current = { ...owner, actorRole: "owner", workspaceMode: "default", demo: false, clerkUserId: "user_live_owner" };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url) !== "https://api.smtp2go.com/v3/email/send") throw new Error(`Unexpected external call to ${String(url)}`);
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
      sentEmails.push({ to: body.to, subject: body.subject });
      return new Response(JSON.stringify({ data: { succeeded: 1, failed: 0, email_id: `smtp2go_${sentEmails.length}` } }), { status: 200 });
    }));
  }, 180000);
  afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await database?.drop(); await stopRelay(); });

  const signed = (type: string, object: Record<string, unknown>, id = `evt_${crypto.randomUUID()}`) => {
    const payload = JSON.stringify({ id, object: "event", type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object } });
    return () => stripeWebhook(new Request("https://app.surveynt.test/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signer.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }) }, body: payload }));
  };
  const paid = (session: Record<string, unknown>) => ({ ...session, status: "complete", payment_status: "paid", payment_intent: `pi_${crypto.randomUUID().replaceAll("-", "")}` });

  it("runs quote, deposit, booking, inspection, approval, issue and balance with real webhooks and email", async () => {
    // 1. A customer requests a quote from the practice website. Live links are HMAC-signed, not random demo tokens.
    const requestId = crypto.randomUUID();
    const created = await createPublicQuote({ organisationId, requestId, firstName: "Live", lastName: "Customer", email: "customer@client.test", answers: { purpose: "survey-only", propertyAge: "post-1990", propertyType: "house" } });
    expect((await createPublicQuote({ organisationId, requestId, firstName: "Live", lastName: "Customer", email: "customer@client.test", answers: { purpose: "survey-only", propertyAge: "post-1990", propertyType: "house" } })).token).toBe(created.token);
    const id = created.quote.id as string, route = { params: Promise.resolve({ id }) };
    const request = (path: string, body?: unknown, token = created.token) => new Request(`https://app.surveynt.test/api/v1/public/quotes/${id}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-quote-token": token }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(await readPublicQuote(id, "forged-token")).toBeNull();

    // 2. Payment is refused before the address is accepted, then opens a Stripe Checkout Session.
    expect((await checkout(request("/checkout", { purpose: "deposit" }), route)).status).toBe(409);
    await acceptQuoteAddress(id, created.token, { line1: "10 Simulation Road", city: "Bristol", postcode: "BS1 4DJ" });
    const depositStart = await (await checkout(request("/checkout", { purpose: "deposit" }), route)).json();
    expect(depositStart.data.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const again = await (await checkout(request("/checkout", { purpose: "deposit" }), route)).json();
    expect(again.data.url).toBe(depositStart.data.url);
    const depositSession = stripeState.created.at(-1)!;
    expect(depositSession.metadata).toMatchObject({ surveyntPaymentKind: "client_deposit", surveyntQuoteId: id, surveyntOrganisationId: organisationId });
    expect((await readPublicQuote(id, created.token))!.view.depositPaid).toBe(false);

    // 3. A tampered amount is rejected; Stripe's signed completion converts the quote into a job exactly once.
    expect((await signed("checkout.session.completed", { ...paid(depositSession), amount_total: 1 })()).ok).toBe(false);
    const completion = signed("checkout.session.completed", paid(depositSession));
    expect((await completion()).ok).toBe(true);
    expect(await (await completion()).json()).toMatchObject({ duplicate: true });
    const converted = (await readPublicQuote(id, created.token))!;
    expect(converted.view.depositPaid).toBe(true);
    const jobId = converted.row.jobId!;

    // 4. The customer books a visit; a repeated click returns the same appointment.
    const choices = (await (await slots(request("/appointments"), route)).json()).data;
    expect(choices.length).toBeGreaterThan(0);
    const first = await (await book(request("/appointments", { startsAt: choices[0].startsAt }), route)).json();
    const second = await (await book(request("/appointments", { startsAt: choices[0].startsAt }), route)).json();
    expect(second.data.id).toBe(first.data.id);

    // 5. Role limits: finance cannot record findings; recording without approval permission cannot approve.
    const finance = { organisationId, internalUserId: null, role: "finance" as const };
    expect((await createSurvey(finance, jobId, { serviceLevel: "level_1" })).kind).toBe("invalid");
    const capture = await createSurvey(owner, jobId, { serviceLevel: "level_1" });
    if (capture.kind !== "created") throw new Error(capture.kind);
    expect((await applySyncOperations(owner, capture.survey.id, inspection())).every((result) => result.status === "applied")).toBe(true);
    const draft = await composeSurveyReport(owner, capture.survey.id);
    await expect(approveReportVersion({ ...owner, canApproveReports: false }, capture.survey.id, draft.id, { confirm: true })).rejects.toMatchObject({ code: "forbidden" });
    expect((await (await reports(request("/reports"), route)).json()).data).toEqual([]);

    // 6. A named approver signs off, the job passes its stage gate and the customer sees the issued report.
    await approveReportVersion(owner, capture.survey.id, draft.id, { confirm: true, note: "Simulated live-practice approval in an isolated test database." });
    await withTenant(createDatabase(), organisationId, async (tx) => {
      expect(await enforceStageGate(tx, owner, { jobId, targetStage: "issued", overrides: [] })).toMatchObject({ kind: "passed" });
    });
    const admin = database.connect(database.adminUrl);
    for (const stage of ["inspection_complete", "report_drafting", "internal_review", "issued"] as const) {
      const [job] = await admin.select().from(jobs).where(eq(jobs.id, jobId));
      const moved = await updateJob(new Request(`https://app.surveynt.test/api/v1/jobs/${jobId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage, version: job.version }) }), { params: Promise.resolve({ id: jobId }) });
      expect(moved.status, `${job.stage} -> ${stage}: ${await moved.clone().text()}`).toBe(200);
    }
    const issued = (await (await reports(request("/reports"), route)).json()).data;
    expect(issued).toHaveLength(1);
    expect((await reports(request("/reports", undefined, "forged-token"), route)).status).toBe(404);

    // 7. The balance goes through its own Checkout Session and signed webhook.
    const balanceStart = await (await checkout(request("/checkout", { purpose: "balance" }), route)).json();
    expect(balanceStart.data.url).toBeTruthy();
    const balanceSession = stripeState.created.at(-1)!;
    expect(balanceSession.metadata).toMatchObject({ surveyntPaymentKind: "client_balance" });
    expect((await signed("checkout.session.completed", paid(balanceSession))()).ok).toBe(true);
    expect((await readPublicQuote(id, created.token))!.view.balanceMinor).toBe(0);
    const db = database.connect(database.adminUrl);
    const payments = await db.select().from(clientPayments).where(eq(clientPayments.quoteId, id));
    expect(payments.map((payment) => payment.status).sort()).toEqual(["succeeded", "succeeded"]);
    expect(payments.every((payment) => payment.stripePaymentIntentId?.startsWith("pi_"))).toBe(true);
    const bills = await db.select().from(invoices).where(eq(invoices.quoteId, id));
    expect(bills.reduce((sum, bill) => sum + bill.totalMinor, 0)).toBe(converted.row.totalMinor);

    // 8. Queued email goes out through SMTP2GO: the client portal invite sent on conversion.
    const queued = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.organisationId, organisationId), eq(backgroundJobs.queue, "email")));
    expect(queued.some((job) => job.type === "client_portal_invite")).toBe(true);
    const result = await processEmailQueue(20);
    expect(result).toMatchObject({ configured: true, failed: 0 });
    const subjects = sentEmails.filter((email) => email.to.includes("customer@client.test")).map((email) => email.subject);
    expect(subjects.some((subject) => /client portal/i.test(subject))).toBe(true);
    expect(subjects.filter((subject) => /^Payment received/.test(subject))).toHaveLength(2);
    expect(subjects.filter((subject) => /^Your survey visit is booked/.test(subject))).toHaveLength(1);
    expect(subjects.filter((subject) => /^Your survey report is ready/.test(subject))).toHaveLength(1);
    const after = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.organisationId, organisationId), eq(backgroundJobs.type, "client_portal_invite")));
    expect(after.every((job) => job.status === "completed")).toBe(true);
  }, 180000);
});
