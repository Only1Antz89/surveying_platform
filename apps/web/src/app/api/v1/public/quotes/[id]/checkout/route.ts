import Stripe from "stripe";
import { clientPayments, createDatabase, organisationOperationalSettings } from "@surveynt/db";
import { eq } from "drizzle-orm";
import { createPendingBalance, createPendingDeposit, readPublicQuote } from "@/lib/firm-operations";
import { ok, problem } from "@/lib/api";

export async function POST(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/checkout">) {
  const { id } = await route.params;
  const rawToken = request.headers.get("x-quote-token") ?? "";
  const found = await readPublicQuote(id, rawToken);
  if (!found || !["accepted", "converted"].includes(found.row.status)) return problem(409, "quote_not_accepted", "Accept the quote and provide the property address before payment.");
  if (!process.env.STRIPE_CLIENT_PAYMENTS_KEY || !process.env.DATABASE_ADMIN_URL) return problem(503, "payments_unavailable", "Client payments are not configured.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [settings] = await db.select({ enabled: organisationOperationalSettings.clientPaymentsEnabled }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, found.row.organisationId)).limit(1);
  if (!settings?.enabled) return problem(409, "payments_disabled", "Online client payments are not enabled for this practice.");
  const requested = await request.json().catch(() => ({})) as { purpose?: string }; const purpose = requested.purpose === "balance" ? "balance" : "deposit";
  if (purpose === "balance" && !found.row.jobId) return problem(409, "deposit_required", "A verified deposit is required before paying the balance.");
  const { payment } = purpose === "balance" ? await createPendingBalance(found.row) : await createPendingDeposit(found.row);
  if (payment.status === "succeeded") return ok({ paid: true, jobId: found.row.jobId });
  if (payment.stripeCheckoutSessionId) {
    const existing = await new Stripe(process.env.STRIPE_CLIENT_PAYMENTS_KEY).checkout.sessions.retrieve(payment.stripeCheckoutSessionId);
    if (existing.status === "open" && existing.url) return ok({ url: existing.url });
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const stripe = new Stripe(process.env.STRIPE_CLIENT_PAYMENTS_KEY);
  const returnUrl = `${appUrl}/quote/${found.row.id}`;
  const session = await stripe.checkout.sessions.create({ mode: "payment", customer_email: found.row.email ?? undefined, line_items: [{ price_data: { currency: found.row.currency.toLowerCase(), unit_amount: payment.amountMinor, product_data: { name: `Survey ${purpose} · ${found.row.reference}` } }, quantity: 1 }], metadata: { surveyntPaymentKind: `client_${purpose}`, surveyntPaymentId: payment.id, surveyntQuoteId: found.row.id, surveyntOrganisationId: found.row.organisationId }, success_url: `${returnUrl}?payment=pending#${encodeURIComponent(rawToken)}`, cancel_url: `${returnUrl}?payment=cancelled#${encodeURIComponent(rawToken)}` }, { idempotencyKey: `client-${purpose}-${payment.id}` });
  await db.update(clientPayments).set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() }).where(eq(clientPayments.id, payment.id));
  return ok({ url: session.url });
}
