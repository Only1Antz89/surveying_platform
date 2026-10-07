import { z } from "zod";
import { and, asc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { clientPayments, createDatabase, invoiceCredits, invoices, settlementBatchItems, settlementBatches, settlementLedger } from "@surveynt/db";
import { canManageFinance } from "@surveynt/domain";
import { apiContext } from "@/lib/access";
import { problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { tenantCsv } from "@/lib/tenant-csv";

const parameters = z.object({ dataset: z.enum(["invoices", "payments", "reconciliation", "credits"]), from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), unsettled: z.enum(["true", "false"]).optional() });
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to export financial records.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (!canManageFinance(context.role)) return problem(403, "forbidden", "Finance access is required.");
  if (context.demo) return problem(409, "preview_only", "Use an authenticated practice to export persistent financial records.");
  const url = new URL(request.url);
  const parsed = parameters.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return problem(400, "invalid_request", "Choose invoices, payments, credits or reconciliation and valid date boundaries.");
  const { dataset, from, to, unsettled } = parsed.data;
  if (from && to && new Date(from) >= new Date(to)) return problem(400, "invalid_range", "The end must follow the start date.");
  let cursor: { id: string; createdAt: string } | undefined;
  const db = createDatabase(undefined,{reuse:false});
  const columns = dataset === "invoices" ? ["id", "number", "currency", "status", "subtotal_minor", "vat_minor", "total_minor", "credited_minor", "adjusted_total_minor", "received_minor", "outstanding_minor", "issued_at", "due_at", "created_at"] : dataset === "payments" ? ["id", "invoice_id", "quote_id", "purpose", "currency", "status", "amount_minor", "refunded_minor", "net_received_minor", "verified_at", "created_at"] : dataset === "credits" ? ["id", "number", "invoice_id", "invoice_number", "currency", "amount_minor", "vat_minor", "net_minor", "reason", "issued_by_user_id", "created_at"] : ["id", "payment_id", "type", "currency", "amount_minor", "settlement_reference", "settled_at", "created_at"];
  const stream = tenantCsv(db, context.organisationId, columns, async tx => {
    const table = dataset === "invoices" ? invoices : dataset === "payments" ? clientPayments : dataset === "credits" ? invoiceCredits : settlementLedger;
    const scope = and(eq(table.organisationId, context.organisationId), from ? gte(table.createdAt, new Date(from)) : undefined, to ? lt(table.createdAt, new Date(to)) : undefined, cursor ? or(sql`${table.createdAt} > ${cursor.createdAt}::timestamptz`, and(sql`${table.createdAt} = ${cursor.createdAt}::timestamptz`, gt(table.id, cursor.id))) : undefined);
    if (dataset === "invoices") {
      const rows = await tx.select({ invoice: invoices, credited: sql<number>`coalesce((select sum(c.amount_minor) from invoice_credits c where c.invoice_id=invoices.id and c.organisation_id=${context.organisationId}),0)::bigint`, cursorCreatedAt: sql<string>`${invoices.createdAt}::text`, received: sql<number>`coalesce((select sum(p.amount_minor-p.refunded_minor) from client_payments p where p.invoice_id=invoices.id and p.organisation_id=${context.organisationId} and p.status in ('succeeded','partially_refunded','refunded')),0)::bigint` }).from(invoices).where(scope).orderBy(asc(invoices.createdAt), asc(invoices.id)).limit(200);
      if (rows.length) cursor = { id: rows.at(-1)!.invoice.id, createdAt: rows.at(-1)!.cursorCreatedAt };
      return rows.map(({ invoice: i, received, credited }) => [i.id, i.number, i.currency, i.status, i.subtotalMinor, i.vatMinor, i.totalMinor, Number(credited), i.totalMinor-Number(credited), Number(received), ["void", "draft"].includes(i.status) ? 0 : Math.max(0, i.totalMinor - Number(credited) - Number(received)), i.issuedAt, i.dueAt, i.createdAt]);
    }
    if (dataset === "payments") {
      const rows = await tx.select({ payment: clientPayments, cursorCreatedAt: sql<string>`${clientPayments.createdAt}::text` }).from(clientPayments).where(scope).orderBy(asc(clientPayments.createdAt), asc(clientPayments.id)).limit(200);
      if (rows.length) cursor = { id: rows.at(-1)!.payment.id, createdAt: rows.at(-1)!.cursorCreatedAt };
      return rows.map(({ payment: p }) => [p.id, p.invoiceId, p.quoteId, p.purpose, p.currency, p.status, p.amountMinor, p.refundedMinor, ["succeeded", "partially_refunded", "refunded"].includes(p.status) ? p.amountMinor-p.refundedMinor : 0, p.succeededAt, p.createdAt]);
    }
    if(dataset === "credits"){
      const rows=await tx.select({credit:invoiceCredits,cursorCreatedAt:sql<string>`${invoiceCredits.createdAt}::text`,invoiceNumber:invoices.number,currency:invoices.currency}).from(invoiceCredits).innerJoin(invoices,and(eq(invoices.id,invoiceCredits.invoiceId),eq(invoices.organisationId,context.organisationId))).where(scope).orderBy(asc(invoiceCredits.createdAt),asc(invoiceCredits.id)).limit(200);
      if(rows.length)cursor={id:rows.at(-1)!.credit.id,createdAt:rows.at(-1)!.cursorCreatedAt};
      return rows.map(({credit:c,invoiceNumber,currency})=>[c.id,c.number,c.invoiceId,invoiceNumber,currency,c.amountMinor,c.vatMinor,c.amountMinor-c.vatMinor,c.reason,c.issuedByUserId,c.createdAt]);
    }
    const rows = await tx.select({ entry: settlementLedger, cursorCreatedAt: sql<string>`${settlementLedger.createdAt}::text`, reference: settlementBatches.reference, settledAt: settlementBatches.settledAt }).from(settlementLedger).leftJoin(settlementBatchItems, eq(settlementBatchItems.ledgerEntryId, settlementLedger.id)).leftJoin(settlementBatches, and(eq(settlementBatches.id, settlementBatchItems.batchId), eq(settlementBatches.organisationId, context.organisationId))).where(and(scope, unsettled === "true" ? isNull(settlementBatchItems.id) : undefined)).orderBy(asc(settlementLedger.createdAt), asc(settlementLedger.id)).limit(200);
    if (rows.length) cursor = { id: rows.at(-1)!.entry.id, createdAt: rows.at(-1)!.cursorCreatedAt };
    return rows.map(({ entry: e, reference, settledAt }) => [e.id, e.paymentId, e.entryType, e.currency, e.amountMinor, reference ?? e.externalSettlementReference, settledAt ?? e.settledAt, e.createdAt]);
  });
  return new Response(stream, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=surveynt-${dataset}.csv`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
