import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  retrieve: vi.fn(), create: vi.fn(), update: vi.fn(),
  found: { row: { id: "quote-test", organisationId: "org-test", status: "accepted", jobId: null, email: "fictional@example.test", currency: "GBP", reference: "TEST-QUOTE" }, view: { demo: false } },
  payment: { id: "payment-test", invoiceId: "invoice-test", organisationId: "org-test", currency: "GBP", amountMinor: 12000, status: "pending", succeededAt: null, stripeCheckoutSessionId: "cs_previous" },
}));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { retrieve: state.retrieve, create: state.create } }; } }));
vi.mock("@surveynt/db", () => ({
  invoices: { id: "invoiceId" }, clientPayments: { id: "paymentId", organisationId: "org" }, organisationOperationalSettings: { clientPaymentsEnabled: "enabled", organisationId: "org" },
  createDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ enabled: true }] }) }) }),
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [state.payment] }) }) }),
      update: () => ({ set: (values: unknown) => ({ where: async () => state.update(values) }) }),
    }),
    update: () => ({ set: (values: unknown) => ({ where: async () => state.update(values) }) }),
  }),
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("./firm-operations", () => ({
  readPublicQuote: async () => state.found,
  createPendingDeposit: async () => ({ payment: state.payment }),
  createPendingBalance: async () => ({ payment: state.payment }),
  convertPaidQuote: vi.fn(), settleBalancePayment: vi.fn(),
}));
import { POST } from "../app/api/v1/public/quotes/[id]/checkout/route";

describe("client Checkout retry safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.payment.status = "pending";
    vi.stubEnv("DATABASE_ADMIN_URL", "local-test-only");
    vi.stubEnv("STRIPE_CLIENT_PAYMENTS_KEY", "test-only-placeholder");
    vi.stubEnv("CLIENT_PAYMENTS_LAUNCH_APPROVED", "true");
    state.create.mockResolvedValue({ id: "cs_retry", url: "https://checkout.stripe.com/test-only" });
  });
  afterEach(() => vi.unstubAllEnvs());
  const checkout = () => POST(new Request("http://surveynt.test/api/v1/public/quotes/quote-test/checkout", {
    method: "POST", headers: { "x-quote-token": "test-token", "content-type": "application/json" }, body: JSON.stringify({ purpose: "deposit" }),
  }), { params: Promise.resolve({ id: "quote-test" }) });

  it("returns pending for a completed Checkout without creating or claiming a payment", async () => {
    state.retrieve.mockResolvedValue({ id: "cs_previous", status: "complete" });
    const body = await (await checkout()).json();
    expect(body.data).toEqual({ pending: true, jobId: null });
    expect(state.create).not.toHaveBeenCalled();expect(state.update).not.toHaveBeenCalled();
  });
  it("reuses an open Checkout", async () => {
    state.retrieve.mockResolvedValue({ id: "cs_previous", status: "open", url: "https://checkout.stripe.com/existing" });
    expect((await (await checkout()).json()).data.url).toBe("https://checkout.stripe.com/existing");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("uses a stable new attempt key after an expired Checkout, with dynamic payment methods", async () => {
    state.retrieve.mockResolvedValue({ id: "cs_previous", status: "expired" });
    await checkout();await checkout();
    expect(state.create).toHaveBeenCalledTimes(2);
    const [parameters, options] = state.create.mock.calls[0];
    expect(options.idempotencyKey).toBe("client-deposit-payment-test-after-cs_previous");
    expect(state.create.mock.calls[1][1]).toEqual(options);
    expect(parameters).not.toHaveProperty("payment_method_types");
    expect(parameters.metadata.surveyntPaymentKind).toBe("client_deposit");
  });
  it("rejects a resolved reservation before contacting the provider", async () => {
    state.payment.status = "failed";
    expect((await checkout()).status).toBe(409);
    expect(state.retrieve).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
  });
  it("keeps the live-payment approval gate enforced", async () => {
    vi.stubEnv("CLIENT_PAYMENTS_LAUNCH_APPROVED", "false");
    expect((await checkout()).status).toBe(409);
    expect(state.retrieve).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();
  });
});
