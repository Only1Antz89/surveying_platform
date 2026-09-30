import { createHash } from "node:crypto";
import Stripe from "stripe";
import { createDatabase, onboardingSteps, organisations, subscriptionEvents, subscriptions, webhookEvents } from "@fieldnote/db";
import { eq } from "drizzle-orm";

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
  const organisationId = subscription.metadata.fieldnoteOrganisationId || local?.organisationId;
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
  const [claim] = await db.insert(webhookEvents).values({ provider: "stripe", providerEventId: event.id, eventType: event.type, payloadHash: createHash("sha256").update(payload).digest("hex") }).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!claim) return Response.json({ received: true, duplicate: true });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const organisationId = session.client_reference_id ?? session.metadata?.fieldnoteOrganisationId;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (organisationId && customerId) {
        await db.update(subscriptions).set({ stripeSubscriptionId: subscriptionId, status: "trialing", seats: Number(session.metadata?.seats ?? 1), updatedAt: new Date() }).where(eq(subscriptions.organisationId, organisationId));
        if (subscriptionId) await synchroniseSubscription(db, stripe, subscriptionId, event);
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
