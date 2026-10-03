import { createHash } from "node:crypto";
import Stripe from "stripe";
import { auditEvents, clientPayments, createDatabase, onboardingSteps, organisations, settlementLedger, subscriptionEvents, subscriptions, webhookEvents } from "@surveynt/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { queueSubscriptionEmail } from "@/lib/email-queue";
import { convertPaidQuote, settleBalancePayment } from "@/lib/firm-operations";

export const runtime = "nodejs";

function mappedStatus(status: Stripe.Subscription.Status) {
  if (["trialing", "active", "past_due", "unpaid", "canceled", "incomplete"].includes(status)) return status as "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete";
  return "incomplete" as const;
}

function stripeDate(value: number | null | undefined) {
  return value ? new Date(value * 1000) : null;
}

function periodEnd(subscription: Stripe.Subscription) {
  const periodEnds = subscription.items.data.map((item) => item.current_period_end).filter(Boolean);
  return periodEnds.length ? new Date(Math.max(...periodEnds) * 1000) : null;
}

async function synchroniseSubscription(
  db: ReturnType<typeof createDatabase>,
  stripe: Stripe,
  stripeSubscriptionId: string,
  event: Stripe.Event,
) {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const [local] = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subscription.id)).limit(1);
  // Read the former key so already-created Stripe subscriptions remain linked.
  const organisationId = subscription.metadata.surveyntOrganisationId || subscription.metadata.fieldnoteOrganisationId || local?.organisationId;
  if (!organisationId) return;

  const status = mappedStatus(subscription.status);
  const graceEndsAt = status === "past_due"
    ? local?.graceEndsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : null;
  const values = {
    stripeSubscriptionId: subscription.id,
    status,
    trialEndsAt: stripeDate(subscription.trial_end),
    currentPeriodEndsAt: periodEnd(subscription),
    graceEndsAt,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: new Date(),
  } as const;

  const [saved] = local
    ? await db.update(subscriptions).set(values).where(eq(subscriptions.id, local.id)).returning()
    : await db.update(subscriptions).set(values).where(eq(subscriptions.organisationId, organisationId)).returning();
  if (!saved) return;

  await db.insert(subscriptionEvents).values({
    organisationId,
    subscriptionId: saved.id,
    type: event.type,
    stripeEventId: event.id,
    metadata: { stripeStatus: subscription.status, eventCreated: event.created },
  }).onConflictDoNothing();

  if (status === "trialing" || status === "active") {
    await db.update(organisations).set({ status: "active", suspendedReason: null, updatedAt: new Date() }).where(eq(organisations.id, organisationId));
    await db.insert(onboardingSteps).values({ organisationId, key: "billing", completedAt: new Date() }).onConflictDoUpdate({ target: [onboardingSteps.organisationId, onboardingSteps.key], set: { completedAt: new Date(), updatedAt: new Date() } });
  }
  if (status === "trialing" && saved.trialEndsAt) {
    await queueSubscriptionEmail({ organisationId, subscriptionId: saved.id, type: "trial_started_notice", deduplicationKey: `trial-started:${saved.id}`, trialEndsAt: saved.trialEndsAt });
  }
  if (status === "past_due" || status === "unpaid") {
    await queueSubscriptionEmail({ organisationId, subscriptionId: saved.id, type: "payment_issue_notice", deduplicationKey: `payment-issue:${event.id}`, status, graceEndsAt: saved.graceEndsAt });
  }
}

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.DATABASE_ADMIN_URL) return Response.json({ error: "Webhook infrastructure is not configured." }, { status: 503 });
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return Response.json({ error: "Invalid Stripe signature." }, { status: 400 }); }

  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  let [claim] = await db.insert(webhookEvents).values({ provider: "stripe", providerEventId: event.id, eventType: event.type, payloadHash }).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!claim) {
    const [existing] = await db.select().from(webhookEvents).where(and(eq(webhookEvents.provider, "stripe"), eq(webhookEvents.providerEventId, event.id))).limit(1);
    if (!existing || existing.payloadHash !== payloadHash) return Response.json({ error: "Webhook event identity conflict." }, { status: 409 });
    if (existing.processedAt || !existing.failedAt) return Response.json({ received: true, duplicate: true });
    [claim] = await db.update(webhookEvents).set({ failedAt: null, error: null }).where(and(eq(webhookEvents.id, existing.id), isNotNull(webhookEvents.failedAt))).returning({ id: webhookEvents.id });
    if (!claim) return Response.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.metadata?.surveyntPaymentKind === "client_deposit" && session.metadata.surveyntPaymentId && session.payment_status === "paid") {
        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
        await convertPaidQuote({ paymentId: session.metadata.surveyntPaymentId, checkoutSessionId: session.id, paymentIntentId });
      } else if (session.metadata?.surveyntPaymentKind === "client_balance" && session.metadata.surveyntPaymentId && session.payment_status === "paid") {
        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
        await settleBalancePayment({ paymentId: session.metadata.surveyntPaymentId, checkoutSessionId: session.id, paymentIntentId });
      } else if (session.mode === "subscription" && session.subscription) {
        const organisationId = session.client_reference_id ?? session.metadata?.surveyntOrganisationId ?? session.metadata?.fieldnoteOrganisationId;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (organisationId && customerId) {
          await db.update(subscriptions).set({ stripeSubscriptionId: subscriptionId, status: "trialing", seats: Number(session.metadata?.seats ?? 1), updatedAt: new Date() }).where(eq(subscriptions.organisationId, organisationId));
          if (subscriptionId) await synchroniseSubscription(db, stripe, subscriptionId, event);
        }
      }
    }
    if (event.type === "charge.refunded") {
      const charge = event.data.object;
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (paymentIntentId) {
        const [payment] = await db.select().from(clientPayments).where(eq(clientPayments.stripePaymentIntentId, paymentIntentId)).limit(1);
        if (payment) {
          const refundedMinor = charge.amount_refunded;
          const status = refundedMinor >= payment.amountMinor ? "refunded" as const : "partially_refunded" as const;
          await db.transaction(async (tx) => {
            const delta = refundedMinor - payment.refundedMinor;
            await tx.update(clientPayments).set({ refundedMinor, status, updatedAt: new Date() }).where(eq(clientPayments.id, payment.id));
            if (delta > 0) await tx.insert(settlementLedger).values({ organisationId: payment.organisationId, paymentId: payment.id, entryType: "refund_liability_adjustment", currency: payment.currency, amountMinor: -delta, metadata: { stripeChargeId: charge.id, stripeEventId: event.id } });
            await tx.insert(auditEvents).values({ organisationId: payment.organisationId, action: "client_payment.refunded", resourceType: "client_payment", resourceId: payment.id, metadata: { refundedMinor, status, stripeEventId: event.id } });
          });
        }
      }
    }
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      await synchroniseSubscription(db, stripe, subscription.id, event);
    }
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, claim.id));
    return Response.json({ received: true });
  } catch (reason) {
    await db.update(webhookEvents).set({ failedAt: new Date(), error: reason instanceof Error ? reason.message.slice(0, 1000) : "Unknown processing error" }).where(eq(webhookEvents.id, claim.id));
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
