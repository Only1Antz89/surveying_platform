import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, clientPayments, customerQuotes, invoices, jobs, manualPaymentReviews, organisationMemberships, organisations, quoteSnapshots, settlementLedger, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
const state = vi.hoisted(() => ({ context: { organisationId: "", internalUserId: "", userId: "deposit-owner", role: "owner", demo: false, accessLevel: "full" }, writable: true }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/access", () => ({ apiContext: async () => state.context, canWriteWorkspace: () => state.writable }));
import { POST as deposit } from "../src/app/api/v1/quotes/[id]/manual-deposit/route";
import { GET as register } from "../src/app/api/v1/finance/deposits/route";
import { POST as refund } from "../src/app/api/v1/finance/payments/[id]/manual-refund/route";
import { POST as checkout } from "../src/app/api/v1/public/quotes/[id]/checkout/route";
import { createPendingDeposit, convertPaidQuote, readPublicQuote } from "../src/lib/firm-operations";

describe.skipIf(!integrationEnabled)("reviewed external quote deposits", () => {
  let database: TestDatabase, db: Database, orgId: string, otherId: string;
  const route = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (body?: unknown) => new Request("http://surveynt.test/api/v1/finance/deposits", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const verification = (amountMinor: number, expectedOutstandingMinor = 1000, version = 1) => ({ requestId: crypto.randomUUID(), version, amountMinor, expectedOutstandingMinor, method: "bank_transfer", reference: `BANK-${crypto.randomUUID()}`, evidence: "Checked fictional settled bank receipt", occurredAt: new Date(Date.now()-60000).toISOString(), confirmed: true });
  async function quote(overrides: Partial<typeof customerQuotes.$inferInsert> = {}) {
    const key = crypto.randomUUID(), token = `deposit-token-${key}`;
    const [row] = await db.insert(customerQuotes).values({ organisationId: orgId, reference: `SVQ-${key}`, status: "accepted", acceptedAt: new Date(), firstName: "Fictional", lastName: "Customer", propertyAddress: "1 Fictional Road, Bristol, BS1 1AA", city: "Bristol", postcode: "BS1 1AA", currency: "GBP", subtotalMinor: 10000, vatMinor: 2000, totalMinor: 12000, depositMinor: 1000, expiresAt: new Date(Date.now()+86400000), accessTokenHash: createHash("sha256").update(token).digest("hex"), pricingSnapshot: { service: "Fictional survey", vatBasisPoints: 2000 }, ...overrides }).returning();
    return { row, token };
  }
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl); vi.stubEnv("DATABASE_APP_URL", database.appUrl);
    const rows = await db.insert(organisations).values([{ clerkOrganisationId: "manual-deposit", slug: "manual-deposit", name: "Deposit practice", practiceType: "building_surveying", region: "Bristol", status: "active" }, { clerkOrganisationId: "deposit-other", slug: "deposit-other", name: "Other practice", practiceType: "building_surveying", region: "Bristol", status: "active" }]).returning();
    orgId = rows[0].id; otherId = rows[1].id;
    const [owner] = await db.insert(users).values({ clerkUserId: "deposit-owner", email: "deposit-owner@example.test" }).returning();
    await db.insert(organisationMemberships).values({ organisationId: orgId, userId: owner.id, role: "owner", active: true });
    Object.assign(state.context, { organisationId: orgId, internalUserId: owner.id });
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });
  it("records partial receipts and instructs exactly one job when the reviewed deposit is complete", async () => {
    const { row, token } = await quote();
    const body = verification(400);
    const first = await deposit(request(body), route(row.id)); expect(first.status).toBe(200); expect((await first.json()).meta).toMatchObject({ jobId: null, outstandingMinor: 600, fundsTransferred: false });
    const records = await (await register(request())).json(); expect(records.data.find((q: {id: string}) => q.id === row.id)).toMatchObject({ outstandingMinor: 600, pendingCheckout: false }); expect(JSON.stringify(records)).not.toContain(row.accessTokenHash);
    const final = verification(600,600);
    const results = await Promise.all([deposit(request(final),route(row.id)), deposit(request(final),route(row.id))]); expect(results.every(r => r.ok)).toBe(true);
    const payloads = await Promise.all(results.map(r => r.json())); expect(payloads[0].data.id).toBe(payloads[1].data.id);
    const [stored] = await db.select().from(customerQuotes).where(eq(customerQuotes.id,row.id)); expect(stored).toMatchObject({ status: "converted", version: 2 }); expect(stored.jobId).not.toBeNull();
    const [job] = await db.select().from(jobs).where(eq(jobs.id,stored.jobId!)); expect(job).toMatchObject({ stage: "instructed", fee: "120.00" });
    const [invoice] = await db.select().from(invoices).where(eq(invoices.quoteId,row.id)); expect(invoice).toMatchObject({ status: "paid", totalMinor: 1000, vatMinor: 167, subtotalMinor: 833, jobId: job.id });
    expect(await db.select().from(manualPaymentReviews).where(eq(manualPaymentReviews.invoiceId,invoice.id))).toHaveLength(2);
    expect(await db.select().from(settlementLedger)).toHaveLength(0);
    expect(await db.select().from(quoteSnapshots).where(and(eq(quoteSnapshots.quoteId,row.id),eq(quoteSnapshots.event,"converted")))).toHaveLength(1);
    expect((await readPublicQuote(row.id,token))?.view).toMatchObject({ depositPaid: true, converted: true, balanceMinor: 11000 });
    const publicRequest = new Request(`http://surveynt.test/api/v1/public/quotes/${row.id}/checkout`, { method: "POST", headers: { "x-quote-token": token, "content-type": "application/json" }, body: "{}" });
    expect((await (await checkout(publicRequest,route(row.id))).json()).data).toMatchObject({ paid: true, jobId: job.id });
    expect((await deposit(request({ ...body, amountMinor: 300 }),route(row.id))).status).toBe(409);
  });
  it("combines a partial external receipt with only the remaining online deposit", async () => {
    const { row,token } = await quote(); expect((await deposit(request(verification(400)),route(row.id))).ok).toBe(true);
    const pending = await createPendingDeposit(row); expect(pending.payment.amountMinor).toBe(600);
    expect((await deposit(request(verification(600,600)),route(row.id))).status).toBe(409);
    const jobId = await convertPaidQuote({ paymentId: pending.payment.id, checkoutSessionId: "cs_mixed_deposit", paymentIntentId: "pi_mixed_deposit" });
    expect(jobId).toBeTruthy(); expect((await readPublicQuote(row.id,token))?.view.depositPaid).toBe(true);
    const ledger = await db.select().from(settlementLedger).where(eq(settlementLedger.paymentId,pending.payment.id)); expect(ledger).toHaveLength(1); expect(ledger[0].amountMinor).toBe(600);
  });
  it("allows refunds of partial external deposits before instruction and retains immutable evidence", async () => {
    const { row,token } = await quote(); await deposit(request(verification(400)),route(row.id));
    const [payment] = await db.select().from(clientPayments).where(eq(clientPayments.quoteId,row.id));
    expect((await refund(request(verification(100)),route(payment.id))).ok).toBe(true);
    expect((await readPublicQuote(row.id,token))?.view.depositPaid).toBe(false);
    const list = await (await register(request())).json(); expect(list.data.find((q: {id: string})=>q.id===row.id).outstandingMinor).toBe(700);
    const [stored] = await db.select().from(customerQuotes).where(eq(customerQuotes.id,row.id)); expect(stored.jobId).toBeNull();
    const [review] = await db.select().from(manualPaymentReviews).where(eq(manualPaymentReviews.paymentId,payment.id)); await expect(db.delete(manualPaymentReviews).where(eq(manualPaymentReviews.id,review.id))).rejects.toThrow();
  });
  it("rejects stale, excessive, expired, unaccepted and foreign deposits and enforces finance permissions", async () => {
    const { row } = await quote();
    for (const body of [verification(1001),verification(100,900),verification(100,1000,2)]) expect((await deposit(request(body),route(row.id))).status).toBe(409);
    for (const overrides of [{ status: "issued" as const },{ expiresAt: new Date(Date.now()-1000) },{ acceptedAt: null },{ propertyAddress: null }]) { const fixture = await quote(overrides); expect((await deposit(request(verification(100)),route(fixture.row.id))).status).toBe(409); }
    state.context.organisationId = otherId; expect((await deposit(request(verification(100)),route(row.id))).status).toBe(404); state.context.organisationId = orgId;
    state.context.role = "surveyor"; expect((await deposit(request(verification(100)),route(row.id))).status).toBe(403); expect((await register(request())).status).toBe(403); state.context.role = "owner";
    state.writable = false; expect((await deposit(request(verification(100)),route(row.id))).status).toBe(403); state.writable = true;
    expect((await deposit(request({ ...verification(100), confirmed: false }),route(row.id))).status).toBe(400);
    expect(await db.select().from(invoices).where(eq(invoices.quoteId,row.id))).toHaveLength(0);
  });
  it("serialises different competing final receipts and rolls back failed reviewer verification", async () => {
    const { row } = await quote();
    const responses = await Promise.all([deposit(request(verification(1000)),route(row.id)),deposit(request(verification(1000)),route(row.id))]); expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const [stored] = await db.select().from(customerQuotes).where(eq(customerQuotes.id,row.id)); expect(await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,stored.jobId!),eq(auditEvents.action,"quote.converted")))).toHaveLength(1);
    const fixture = await quote(); const original = state.context.internalUserId; state.context.internalUserId = crypto.randomUUID();
    await expect(deposit(request(verification(1000)),route(fixture.row.id))).rejects.toThrow(); state.context.internalUserId = original;
    expect(await db.select().from(invoices).where(eq(invoices.quoteId,fixture.row.id))).toHaveLength(0); expect(await db.select().from(clientPayments).where(eq(clientPayments.quoteId,fixture.row.id))).toHaveLength(0);
  });
});
