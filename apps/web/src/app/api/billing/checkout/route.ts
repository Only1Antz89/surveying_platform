import Stripe from "stripe";
import { currentUser } from "@clerk/nextjs/server";
import { createDatabase, organisations, subscriptions } from "@fieldnote/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const requestSchema = z.object({ seats: z.number().int().min(1).max(250).default(1) });

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_BASE_PRICE_ID) return problem(503, "billing_not_configured", "Stripe billing has not been connected yet.");
  const context = await apiContext(request);
  if (!context || context.demo) return problem(401, "unauthorised", "A verified account and organisation are required before checkout.");
  const parsed = await parseBody(request, requestSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The requested seat quantity is invalid.");

  const db = createDatabase(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL);
  const [organisation] = await db.select().from(organisations).where(eq(organisations.id, context.organisationId)).limit(1);
  if (!organisation) return problem(404, "organisation_not_found", "The organisation could not be found.");
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.organisationId, organisation.id)).limit(1);
  if (existing && (existing.status === "trialing" || existing.status === "active" || existing.status === "past_due")) {
    return problem(409, "subscription_exists", "This practice already has a subscription. Manage it from billing settings.");
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let customerId = existing?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: organisation.name, email, metadata: { fieldnoteOrganisationId: organisation.id, clerkOrganisationId: organisation.clerkOrganisationId } });
    customerId = customer.id;
    await db.insert(subscriptions).values({ organisationId: organisation.id, stripeCustomerId: customerId, status: "incomplete", seats: parsed.data.seats }).onConflictDoNothing();
  } else {
    await db.update(subscriptions).set({ seats: parsed.data.seats, updatedAt: new Date() }).where(eq(subscriptions.organisationId, organisation.id));
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: process.env.STRIPE_BASE_PRICE_ID, quantity: 1 }];
  if (process.env.STRIPE_SEAT_PRICE_ID && parsed.data.seats > 1) lineItems.push({ price: process.env.STRIPE_SEAT_PRICE_ID, quantity: parsed.data.seats - 1 });
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: organisation.id,
    line_items: lineItems,
    payment_method_collection: "always",
    automatic_tax: { enabled: true },
    subscription_data: { trial_period_days: 14, metadata: { fieldnoteOrganisationId: organisation.id } },
    metadata: { fieldnoteOrganisationId: organisation.id, seats: String(parsed.data.seats) },
    success_url: `${appUrl}/app/${organisation.slug}/overview?trial=started`,
    cancel_url: `${appUrl}/trial/checkout?checkout=cancelled`,
  });
  return ok({ url: session.url });
}
