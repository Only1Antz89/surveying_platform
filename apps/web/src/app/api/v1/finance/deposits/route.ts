import { z } from "zod";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createDatabase, customerQuotes, withTenant } from "@surveynt/db";
import { canManageFinance } from "@surveynt/domain";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to review quote deposits.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (!canManageFinance(context.role) || context.demo) return problem(403, "forbidden", "Authenticated finance access is required.");
  const parsed = z.coerce.number().int().min(0).max(1000000).safeParse(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!parsed.success) return problem(400, "invalid_request", "Choose a valid register page.");
  const rows = await withTenant(createDatabase(), context.organisationId, tx => tx.select({
    id: customerQuotes.id, version: customerQuotes.version, reference: customerQuotes.reference,
    firstName: customerQuotes.firstName, lastName: customerQuotes.lastName, currency: customerQuotes.currency,
    depositMinor: customerQuotes.depositMinor, expiresAt: customerQuotes.expiresAt,
    outstandingMinor: sql<number>`greatest(0, ${customerQuotes.depositMinor} - coalesce((select sum(p.amount_minor-p.refunded_minor) from client_payments p where p.quote_id=customer_quotes.id and p.organisation_id=${context.organisationId} and p.purpose in ('deposit','manual_deposit') and p.status in ('succeeded','partially_refunded','refunded')),0))::integer`,
    pendingCheckout: sql<boolean>`exists(select 1 from client_payments p where p.quote_id=customer_quotes.id and p.organisation_id=${context.organisationId} and p.purpose='deposit' and p.status='pending')`,
  }).from(customerQuotes).where(and(eq(customerQuotes.organisationId, context.organisationId), eq(customerQuotes.status, "accepted"), isNull(customerQuotes.jobId), gt(customerQuotes.expiresAt, new Date()), gt(customerQuotes.depositMinor, 0))).orderBy(desc(customerQuotes.createdAt), desc(customerQuotes.id)).limit(26).offset(parsed.data));
  return ok(rows.slice(0,25), { nextOffset: rows.length > 25 ? parsed.data + 25 : null });
}
