import Stripe from "stripe";
import { clientPayments, createDatabase, invoices, organisationOperationalSettings } from "@surveynt/db";
import { and, eq } from "drizzle-orm";
import { convertPaidQuote, settleBalancePayment, createPendingBalance, createPendingDeposit, readPublicQuote } from "@/lib/firm-operations";
import { ok, problem } from "@/lib/api";

export async function POST(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/checkout">) {
  const { id } = await route.params;
  const rawToken = request.headers.get("x-quote-token") ?? "";
  const found = await readPublicQuote(id, rawToken);
  if (!found || !["accepted", "converted"].includes(found.row.status)) return problem(409, "quote_not_accepted", "Accept the quote and provide the property address before payment.");
  const paymentInput = await request.json().catch(() => ({})) as { purpose?: string; scenario?: string };
  if(paymentInput.purpose !== "balance" && found.view.depositPaid && found.row.jobId)return ok({paid:true,jobId:found.row.jobId});
  if(paymentInput.purpose === "balance" && found.view.balancePaid)return ok({paid:true,jobId:found.row.jobId});
  if (found.view.demo) {
    const requested = paymentInput;
    if (requested.scenario === "failure") return problem(402, "demo_payment_failed", "Simulated payment declined. No money was charged. Try again to demonstrate success.");
    const balance = requested.purpose === "balance";
    if (balance && !found.row.jobId) return problem(409, "deposit_required", "Complete the simulated deposit first.");
    const { payment } = balance ? await createPendingBalance(found.row) : await createPendingDeposit(found.row);
    if(payment.succeededAt&&payment.refundedMinor>0)return problem(409,"payment_refunded","This payment has a recorded refund. Contact the practice to review the outstanding invoice; another charge will not be created automatically.");
    const jobId = payment.status === "succeeded" ? found.row.jobId : await (balance ? settleBalancePayment : convertPaidQuote)({ paymentId: payment.id, checkoutSessionId: `demo_${payment.id}`, paymentIntentId: null });
    return ok({ paid: true, jobId, simulated: true });
  }
  if (!process.env.STRIPE_CLIENT_PAYMENTS_KEY || !process.env.DATABASE_ADMIN_URL) return problem(503, "payments_unavailable", "Client payments are not configured.");
  if(process.env.CLIENT_PAYMENTS_LAUNCH_APPROVED!=="true")return problem(409,"pending_approval","Live client payments require legal, accounting, VAT and client-money launch approval.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [settings] = await db.select({ enabled: organisationOperationalSettings.clientPaymentsEnabled }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, found.row.organisationId)).limit(1);
  if (!settings?.enabled) return problem(409, "payments_disabled", "Online client payments are not enabled for this practice.");
  const requested = paymentInput; const purpose = requested.purpose === "balance" ? "balance" : "deposit";
  if (purpose === "balance" && !found.row.jobId) return problem(409, "deposit_required", "A verified deposit is required before paying the balance.");
  const { payment } = purpose === "balance" ? await createPendingBalance(found.row) : await createPendingDeposit(found.row);
  if (payment.status === "succeeded") return ok({ paid: true, jobId: found.row.jobId });
  if(payment.succeededAt)return problem(409,"payment_refunded","Contact the practice to review this refunded payment. It will not be charged again automatically.");
  // Hold the invoice/payment boundary through provider calls. Finance must not resolve a
  // Checkout while a stale customer request is recreating a session for that payment.
  return db.transaction(async tx => {
    await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id,payment.invoiceId)).for("update");
    const [current] = await tx.select().from(clientPayments).where(and(eq(clientPayments.id,payment.id),eq(clientPayments.organisationId,found.row.organisationId))).for("update");
    if (!current || current.status !== "pending" || current.succeededAt) return problem(409,"payment_changed","The payment changed. Reload the customer quote before trying again.");
    let previousExpiredSession: string | null = null;
    const stripe = new Stripe(process.env.STRIPE_CLIENT_PAYMENTS_KEY!);
    if (current.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
      if (existing.status === "open" && existing.url) return ok({ url: existing.url });
      if (existing.status === "complete") return ok({ pending: true, jobId: found.row.jobId });
      if (existing.status !== "expired") return problem(409, "payment_pending", "This checkout is still being processed. Please wait for verification.");
      previousExpiredSession = existing.id;
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const returnUrl = `${appUrl}/quote/${found.row.id}`;
    const session = await stripe.checkout.sessions.create({ mode: "payment", customer_email: found.row.email ?? undefined, line_items: [{ price_data: { currency: current.currency.toLowerCase(), unit_amount: current.amountMinor, product_data: { name: `Survey ${purpose} · ${found.row.reference}` } }, quantity: 1 }], metadata: { surveyntPaymentKind: `client_${purpose}`, surveyntPaymentId: current.id, surveyntQuoteId: found.row.id, surveyntOrganisationId: found.row.organisationId }, success_url: `${returnUrl}?payment=pending#${encodeURIComponent(rawToken)}`, cancel_url: `${returnUrl}?payment=cancelled#${encodeURIComponent(rawToken)}` }, { idempotencyKey: `client-${purpose}-${current.id}${previousExpiredSession ? `-after-${previousExpiredSession}` : ""}` });
    await tx.update(clientPayments).set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() }).where(eq(clientPayments.id, current.id));
    return ok({ url: session.url });
  });
}
