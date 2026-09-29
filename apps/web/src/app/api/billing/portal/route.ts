import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { canManageBilling } from "@fieldnote/domain";
import { createDatabase, organisations, subscriptions } from "@fieldnote/db";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) return problem(503, "billing_not_configured", "Stripe billing has not been connected yet.");
  const context = await apiContext(request);
  if (!context || context.demo) return problem(401, "unauthorised", "A verified account and organisation are required.");
  if (!canManageBilling(context.role)) return problem(403, "forbidden", "Your role cannot manage billing.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL);
  const [record] = await db.select({ customerId: subscriptions.stripeCustomerId, slug: organisations.slug }).from(subscriptions).innerJoin(organisations, eq(subscriptions.organisationId, organisations.id)).where(eq(subscriptions.organisationId, context.organisationId)).limit(1);
  if (!record) return problem(409, "subscription_missing", "This workspace does not have a billing profile yet.");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.billingPortal.sessions.create({ customer: record.customerId, return_url: `${appUrl}/app/${record.slug}/settings/billing` });
  return ok({ url: session.url });
}
