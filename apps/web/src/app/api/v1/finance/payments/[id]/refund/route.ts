import {workspaceAudit} from "@/lib/workspace-audit";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import Stripe from "stripe";
import { z } from "zod";
import { canManageFinance } from "@surveynt/domain";
import { and, eq } from "drizzle-orm";
import { auditEvents, clientPayments, createDatabase, withTenant } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
const schema = z.object({ amountMinor: z.number().int().positive().optional(), reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).default("requested_by_customer") });
export async function POST(request: Request, route: RouteContext<"/api/v1/finance/payments/[id]/refund">) {
  const demoContext = await apiContext(request);
  if (demoContext && !demoContext.demo && await isDemoOrganisation(demoContext.organisationId)) return problem(409, "demo_isolated", "Use the simulated refund action in this demo practice. No live refund can be sent.");
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); if (!canWriteWorkspace(context) || !canManageFinance(context.role)) return problem(403, "forbidden", "Only owners and administrators can request refunds."); if (!process.env.STRIPE_CLIENT_PAYMENTS_KEY) return problem(503, "payments_unavailable", "Client payments are not configured."); const parsed = await parseBody(request, schema); if (!parsed.success) return problem(400, "invalid_request", "The refund request is invalid."); const { id } = await route.params;
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const [payment] = context.demo ? [] : await withTenant(createDatabase(), context.organisationId, (tx) => tx.select().from(clientPayments).where(and(eq(clientPayments.id, id), eq(clientPayments.organisationId, context.organisationId))).limit(1)); if (!payment?.stripePaymentIntentId || payment.status === "pending" || payment.status === "failed") return problem(409, "not_refundable", "This payment cannot be refunded."); const remaining = payment.amountMinor - payment.refundedMinor; const amount = parsed.data.amountMinor ?? remaining; if (amount > remaining) return problem(400, "amount_too_high", "The refund exceeds the remaining paid amount.");
  const stripe = new Stripe(process.env.STRIPE_CLIENT_PAYMENTS_KEY); const refund = await stripe.refunds.create({ payment_intent: payment.stripePaymentIntentId, amount, reason: parsed.data.reason, metadata: { surveyntPaymentId: payment.id, surveyntOrganisationId: context.organisationId } }, { idempotencyKey: `client-refund-${payment.id}-${payment.refundedMinor}-${amount}` });
  await withTenant(createDatabase(), context.organisationId, (tx) => tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_payment.refund_requested", resourceType: "client_payment", resourceId: payment.id, metadata: { stripeRefundId: refund.id, amountMinor: amount, reason: parsed.data.reason } })));
  return ok({ refundId: refund.id, status: refund.status, amountMinor: amount }, { pendingWebhookConfirmation: true });
}
