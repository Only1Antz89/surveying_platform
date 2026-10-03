import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createDatabase, backgroundJobs, communicationDeliveries, organisations } from "@surveynt/db";
import { eq } from "drizzle-orm";
import { applicationUrl } from "@/lib/email";
import { readPublicQuote } from "@/lib/firm-operations";
import { ok, problem } from "@/lib/api";

export async function POST(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/email">) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "quote_not_found", "The quote could not be found.");
  const rawToken = request.headers.get("x-quote-token") ?? "";
  const found = await readPublicQuote(id, rawToken);
  if (!found?.row.email) return problem(400, "email_required", "Add an email address before requesting delivery.");
  if (!process.env.DATABASE_ADMIN_URL) return problem(503, "email_unavailable", "Email delivery is not configured.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [organisation] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, found.row.organisationId)).limit(1);
  const format = new Intl.NumberFormat("en-GB", { style: "currency", currency: found.row.currency });
  const deliveryId = randomUUID();
  const job = await db.transaction(async (tx) => {
    const [created] = await tx.insert(backgroundJobs).values({ organisationId: found.row.organisationId, queue: "email", type: "customer_quote_issued", deduplicationKey: `quote-email:${found.row.id}:${found.row.version}`, payload: { recipients: [found.row.email], organisationName: organisation?.name ?? "Your surveyor", customerName: found.row.firstName ?? "there", quoteReference: found.row.reference, total: format.format(found.row.totalMinor / 100), expiresAt: found.row.expiresAt.toISOString(), quoteUrl: `${applicationUrl()}/quote/${found.row.id}#${rawToken}`, deliveryId } }).onConflictDoNothing().returning({ id: backgroundJobs.id });
    if (created) await tx.insert(communicationDeliveries).values({ id: deliveryId, organisationId: found.row.organisationId, quoteId: found.row.id, recipient: found.row.email!, subject: `Your survey quote · ${found.row.reference}` });
    return created;
  });
  return ok({ queued: Boolean(job) });
}
