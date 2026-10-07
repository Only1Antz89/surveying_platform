import Stripe from "stripe";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auditEvents, clientPayments, createDatabase, invoices, withTenant } from "@surveynt/db";
import { canManageFinance } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
const schema = z.object({ expectedSessionId: z.string().min(1), reason: z.string().trim().min(10).max(1000), confirmed: z.literal(true) });

export async function POST(request: Request, route: RouteContext<"/api/v1/finance/payments/[id]/resolve-checkout">) {
  const context = await apiContext(request);
  if (!context) return problem(401,"unauthorised","Sign in to review a pending Checkout.");
  const denial = await workspaceApiGuard(request,context);
  if (denial) return denial;
  if (!canWriteWorkspace(context) || !canManageFinance(context.role) || context.demo) return problem(403,"forbidden","A finance reviewer in a writable authenticated practice is required.");
  if (await isDemoOrganisation(context.organisationId)) return problem(409,"demo_isolated","Demo practices cannot cancel live Checkouts.");
  if (!process.env.STRIPE_CLIENT_PAYMENTS_KEY) return problem(503,"payments_unavailable","Client payments are not configured.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404,"payment_not_found","Payment not found.");
  const parsed = await parseBody(request,schema);
  if (!parsed.success) return problem(400,"invalid_request","Review the pending session, cancellation reason and confirmation.");
  const db = createDatabase(), stripe = new Stripe(process.env.STRIPE_CLIENT_PAYMENTS_KEY);
  try {
    return await withTenant(db,context.organisationId,async tx => {
      const [found] = await tx.select().from(clientPayments).where(and(eq(clientPayments.id,id),eq(clientPayments.organisationId,context.organisationId))).limit(1);
      if (!found) return problem(404,"payment_not_found","Payment not found.");
      await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id,found.invoiceId),eq(invoices.organisationId,context.organisationId))).for("update");
      const [payment] = await tx.select().from(clientPayments).where(eq(clientPayments.id,id)).for("update");
      if (payment.stripeCheckoutSessionId !== parsed.data.expectedSessionId || !["deposit","balance"].includes(payment.purpose) || payment.succeededAt) return problem(409,"payment_changed","Reload the invoice before resolving this Checkout.");
      if (payment.status === "failed") return ok({ id, resolved: true },{ duplicate: true, fundsTransferred: false });
      if (payment.status !== "pending") return problem(409,"payment_changed","This payment is no longer pending.");
      let session = await stripe.checkout.sessions.retrieve(parsed.data.expectedSessionId);
      const matches = () => session.id === payment.stripeCheckoutSessionId && session.mode === "payment" && session.amount_total === payment.amountMinor && session.currency?.toUpperCase() === payment.currency.toUpperCase() && session.metadata?.surveyntPaymentId === payment.id && session.metadata?.surveyntOrganisationId === context.organisationId && session.metadata?.surveyntQuoteId === payment.quoteId && session.metadata?.surveyntPaymentKind === `client_${payment.purpose}`;
      if (!matches()) return problem(409,"session_mismatch","The provider session does not match this practice payment.");
      if (session.status === "complete" || session.payment_status === "paid") return problem(409,"awaiting_receipt","This Checkout completed. Wait for its verified receipt before reviewing a refund or adjustment.");
      if (session.status === "open") session = await stripe.checkout.sessions.expire(session.id,{},{ idempotencyKey: `resolve-checkout-${payment.id}-${session.id}` });
      if (!matches() || session.status !== "expired" || session.payment_status === "paid") return problem(409,"checkout_pending","The provider has not confirmed that this unpaid Checkout expired.");
      await tx.update(clientPayments).set({ status: "failed", updatedAt: new Date() }).where(eq(clientPayments.id,id));
      await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_payment.checkout_resolved", resourceType: "client_payment", resourceId: id, metadata: { checkoutSessionId: session.id, providerStatus: session.status, reason: parsed.data.reason, fundsTransferred: false } });
      return ok({ id, resolved: true },{ fundsTransferred: false });
    });
  } catch { return problem(503,"provider_unavailable","Checkout resolution could not be confirmed. Retry the same session; no resolution has been confirmed."); }
}
