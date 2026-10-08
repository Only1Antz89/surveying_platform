import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, clientPayments, customerQuotes, invoices, organisations, subscriptions, onboardingSteps, subscriptionEvents, webhookEvents, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
const state = vi.hoisted(() => ({ retrieve: vi.fn(), deposit: vi.fn(), balance: vi.fn(), email: vi.fn() }));
vi.mock("stripe", async importOriginal => {
  const original = await importOriginal<typeof import("stripe")>();
  return { ...original, default: class extends original.default {
    constructor(...args: ConstructorParameters<typeof original.default>) {
      super(...args);
      this.subscriptions.retrieve = state.retrieve;
    }
  } };
});
vi.mock("../src/lib/email-queue", () => ({ queueSubscriptionEmail: state.email }));
vi.mock("../src/lib/firm-operations", () => ({ convertPaidQuote: state.deposit, settleBalancePayment: state.balance }));
import Stripe from "stripe";
import { POST } from "../src/app/api/webhooks/stripe/route";

describe.skipIf(!integrationEnabled)("signed Stripe routing and platform lifecycle", () => {
  let database: TestDatabase, db: Database;
  const secret = "whsec_local_signed_regression";
  const stripe = new Stripe("sk_test_local_no_network");
  const event = (type: string, object: Record<string, unknown>, id = `evt_${crypto.randomUUID()}`) => JSON.stringify({ id, object: "event", type, created: Math.floor(Date.now()/1000), livemode: false, data: { object } });
  const deliver = (payload: string, signature?: string) => POST(new Request("http://surveynt.test/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload }));
  async function practice(status: "provisioning" | "active" | "suspended" | "closed") {
    const key = crypto.randomUUID();
    const [org] = await db.insert(organisations).values({ clerkOrganisationId: `org_${key}`, slug: key, name: "Stripe regression practice", practiceType: "building_surveying", region: "Bristol", status, suspendedReason: status === "suspended" ? "Platform review restriction" : null }).returning();
    const [subscription] = await db.insert(subscriptions).values({ organisationId: org.id, stripeCustomerId: `cus_${key}`, stripeSubscriptionId: `sub_${key}`, status: "incomplete" }).returning();
    return { org, subscription };
  }
  async function checkout(purpose: "deposit" | "balance") {
    const { org } = await practice("suspended");
    const key = crypto.randomUUID();
    const [quote] = await db.insert(customerQuotes).values({ organisationId: org.id, reference: key, subtotalMinor: 1000, vatMinor: 0, totalMinor: 1000, depositMinor: 100, expiresAt: new Date(Date.now()+86400000), accessTokenHash: key }).returning();
    const [invoice] = await db.insert(invoices).values({ organisationId: org.id, quoteId: quote.id, number: key, totalMinor: 1000, subtotalMinor: 1000, vatMinor: 0 }).returning();
    const [payment] = await db.insert(clientPayments).values({ organisationId: org.id, quoteId: quote.id, invoiceId: invoice.id, purpose, amountMinor: 1000, stripeCheckoutSessionId: `cs_${key}` }).returning();
    return { id: payment.stripeCheckoutSessionId!, mode: "payment", payment_status: "paid", payment_intent: `pi_${key}`, amount_total: 1000, currency: "gbp", metadata: { surveyntPaymentKind: `client_${purpose}`, surveyntPaymentId: payment.id, surveyntQuoteId: quote.id, surveyntOrganisationId: org.id } };
  }
  function provider(id: string, organisationId: string, status = "active") {
    return { id, status, metadata: { surveyntOrganisationId: organisationId }, trial_end: null, cancel_at_period_end: false, items: { data: [{ current_period_end: Math.floor(Date.now()/1000)+86400 }] } };
  }
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_no_network"); vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.drop(); await stopRelay(); });
  it("preserves platform suspension and closure while synchronising billing status", async () => {
    for (const status of ["suspended", "closed"] as const) {
      const { org, subscription } = await practice(status);
      for (const billing of ["active", "trialing"]) {
        state.retrieve.mockResolvedValue(provider(subscription.stripeSubscriptionId!, org.id, billing));
        expect((await deliver(event("customer.subscription.updated", { id: subscription.stripeSubscriptionId }))).ok).toBe(true);
        const [stored] = await db.select().from(organisations).where(eq(organisations.id, org.id));
        const [updated] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
        expect(stored.status).toBe(status); expect(stored.suspendedReason).toBe(org.suspendedReason);
        expect(updated.status).toBe(billing);
      }
    }
  });
  it("activates a provisioning practice and uses current provider state for out-of-order events", async () => {
    const { org, subscription } = await practice("provisioning");
    state.retrieve.mockResolvedValue(provider(subscription.stripeSubscriptionId!, org.id));
    expect((await deliver(event("customer.subscription.updated", { id: subscription.stripeSubscriptionId, status: "past_due" }))).ok).toBe(true);
    const [stored] = await db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(stored.status).toBe("active");
    expect(await db.select().from(onboardingSteps).where(and(eq(onboardingSteps.organisationId, org.id), eq(onboardingSteps.key, "billing")))).toHaveLength(1);
    const [saved] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(saved.status).toBe("active");
  });
  it("routes signed paid client Checkout events independently of subscription Checkout", async () => {
    state.deposit.mockClear(); state.balance.mockClear(); state.retrieve.mockClear();
    for (const [kind, method] of [["client_deposit", state.deposit], ["client_balance", state.balance]] as const) {
      const session = await checkout(kind === "client_deposit" ? "deposit" : "balance");
      const payload = event("checkout.session.completed", session);
      expect((await deliver(payload)).ok).toBe(true);
      expect(method).toHaveBeenCalledWith({ paymentId: session.metadata.surveyntPaymentId, checkoutSessionId: session.id, paymentIntentId: session.payment_intent });
      expect((await (await deliver(payload)).json()).duplicate).toBe(true);
      expect(method).toHaveBeenCalledTimes(1);
    }
    expect(state.retrieve).not.toHaveBeenCalled();
    expect((await deliver(event("checkout.session.completed", { id: "cs_unpaid", mode: "payment", payment_status: "unpaid", metadata: { surveyntPaymentKind: "client_deposit", surveyntPaymentId: "not_paid" } }))).ok).toBe(true);
    expect(state.deposit).toHaveBeenCalledTimes(1);
  });
  it("rejects signed receipts with mismatched amounts, currency, ownership, purpose or processor identity", async () => {
    state.deposit.mockClear(); state.balance.mockClear();
    const session = await checkout("deposit");
    for (const changed of [
      { ...session, amount_total: 999 }, { ...session, currency: "usd" },
      { ...session, id: "cs_different" }, { ...session, payment_intent: null },
      { ...session, metadata: { ...session.metadata, surveyntOrganisationId: crypto.randomUUID() } },
      { ...session, metadata: { ...session.metadata, surveyntQuoteId: crypto.randomUUID() } },
      { ...session, metadata: { ...session.metadata, surveyntPaymentKind: "client_balance" } },
    ]) {
      const payload = event("checkout.session.completed", changed);
      expect((await deliver(payload)).status).toBe(500);
      const [claim] = await db.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, JSON.parse(payload).id));
      expect(claim.failedAt).not.toBeNull(); expect(claim.processedAt).toBeNull();
    }
    expect(state.deposit).not.toHaveBeenCalled(); expect(state.balance).not.toHaveBeenCalled();
  });
  it("releases verified expired reservations, recovers a lost session write and ignores superseded expiry", async () => {
    const session = await checkout("deposit");
    await db.update(clientPayments).set({ stripeCheckoutSessionId: null }).where(eq(clientPayments.id,session.metadata.surveyntPaymentId));
    const expired = { ...session, status: "expired", payment_status: "unpaid", payment_intent: null };
    expect((await deliver(event("checkout.session.expired",expired))).ok).toBe(true);
    const [stored] = await db.select().from(clientPayments).where(eq(clientPayments.id,session.metadata.surveyntPaymentId));
    expect(stored).toMatchObject({ status: "failed", stripeCheckoutSessionId: session.id });
    const newer = await checkout("balance");
    expect((await deliver(event("checkout.session.expired",{ ...newer,id: "cs_superseded",status: "expired",payment_status: "unpaid" }))).ok).toBe(true);
    const [pending] = await db.select().from(clientPayments).where(eq(clientPayments.id,newer.metadata.surveyntPaymentId));
    expect(pending.status).toBe("pending");
    expect((await deliver(event("checkout.session.expired",{ ...newer,status: "expired",payment_status: "unpaid",amount_total: 1 }))).status).toBe(500);
  });
  it("settles delayed payment methods only when Stripe reports the later outcome", async () => {
    state.deposit.mockClear(); state.balance.mockClear();
    // Completed but unpaid (for example Bacs Direct Debit): nothing is settled yet.
    const delayed = await checkout("deposit");
    expect((await deliver(event("checkout.session.completed", { ...delayed, status: "complete", payment_status: "unpaid" }))).ok).toBe(true);
    expect(state.deposit).not.toHaveBeenCalled();
    const succeeded = event("checkout.session.async_payment_succeeded", { ...delayed, status: "complete", payment_status: "paid" });
    expect((await deliver(succeeded)).ok).toBe(true);
    expect(state.deposit).toHaveBeenCalledWith({ paymentId: delayed.metadata.surveyntPaymentId, checkoutSessionId: delayed.id, paymentIntentId: delayed.payment_intent });
    expect((await (await deliver(succeeded)).json()).duplicate).toBe(true);
    expect(state.deposit).toHaveBeenCalledTimes(1);
    // A failed delayed payment releases the reservation like an expired Checkout, with its own audit action.
    const failing = await checkout("balance");
    expect((await deliver(event("checkout.session.async_payment_failed", { ...failing, status: "complete", payment_status: "unpaid" }))).ok).toBe(true);
    const [released] = await db.select().from(clientPayments).where(eq(clientPayments.id, failing.metadata.surveyntPaymentId));
    expect(released.status).toBe("failed");
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, failing.metadata.surveyntPaymentId));
    expect(audits.map(audit => audit.action)).toContain("client_payment.async_payment_failed");
    expect(state.balance).not.toHaveBeenCalled();
    // A mismatched failure is rejected for retry rather than releasing the payment.
    const mismatched = await checkout("deposit");
    expect((await deliver(event("checkout.session.async_payment_failed", { ...mismatched, status: "complete", payment_status: "unpaid", amount_total: 1 }))).status).toBe(500);
  });
  it("routes subscription Checkout without granting access to a suspended practice", async () => {
    const { org, subscription } = await practice("suspended");
    state.retrieve.mockResolvedValue(provider(subscription.stripeSubscriptionId!, org.id));
    expect((await deliver(event("checkout.session.completed", { id: "cs_subscription", mode: "subscription", subscription: subscription.stripeSubscriptionId, customer: "cus_local", client_reference_id: org.id, metadata: { seats: "3" } }))).ok).toBe(true);
    const [saved] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(saved).toMatchObject({ status: "active", seats: 3 });
    const [stored] = await db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(stored.status).toBe("suspended");
  });
  it("rejects invalid signatures and conflicting event identities without applying them", async () => {
    const { org, subscription } = await practice("provisioning");
    state.retrieve.mockResolvedValue(provider(subscription.stripeSubscriptionId!, org.id));
    const payload = event("customer.subscription.updated", { id: subscription.stripeSubscriptionId });
    expect((await deliver(payload, "not-a-valid-signature")).status).toBe(400);
    const [stored] = await db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(stored.status).toBe("provisioning");
    expect((await deliver(payload)).ok).toBe(true);
    const changed = JSON.stringify({ ...JSON.parse(payload), data: { object: { id: "different_subscription" } } });
    expect((await deliver(changed)).status).toBe(409);
  });
  it("retries failed deliveries and records each subscription event once", async () => {
    const { org, subscription } = await practice("provisioning");
    const payload = event("customer.subscription.updated", { id: subscription.stripeSubscriptionId });
    state.retrieve.mockRejectedValueOnce(new Error("Transient provider failure")).mockResolvedValue(provider(subscription.stripeSubscriptionId!, org.id));
    expect((await deliver(payload)).status).toBe(500);
    expect((await deliver(payload)).ok).toBe(true);
    const id = JSON.parse(payload).id;
    expect(await db.select().from(subscriptionEvents).where(eq(subscriptionEvents.stripeEventId, id))).toHaveLength(1);
    const [claim] = await db.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, id));
    expect(claim.failedAt).toBeNull(); expect(claim.processedAt).not.toBeNull();
  });
});
