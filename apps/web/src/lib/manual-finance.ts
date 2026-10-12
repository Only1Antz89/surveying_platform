import {workspaceAudit} from "@/lib/workspace-audit";
import { invoiceBalance, refreshInvoiceBalance } from "./invoice-balance";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, clientPayments, createDatabase, customerQuotes, invoices, manualPaymentReviews, withTenant } from "@surveynt/db";
import { ensureQuoteInvoice, instructPaidQuote } from "./firm-operations";
import { z } from "zod";
import { ok, problem } from "./api";

export const manualReviewSchema = z.object({
  requestId: z.uuid(), amountMinor: z.number().int().min(1).max(2147483647),
  expectedOutstandingMinor: z.number().int().nonnegative().optional(),
  method: z.enum(["bank_transfer", "cash", "cheque", "external_card"]),
  reference: z.string().trim().min(3).max(120), evidence: z.string().trim().min(10).max(2000),
  occurredAt: z.iso.datetime(), confirmed: z.literal(true),
}).refine(value => new Date(value.occurredAt).getTime() <= Date.now() + 60000, "Only completed external transactions may be verified.");

type Context = { organisationId: string; internalUserId: string | null };
export async function recordManualReview(context: Context, invoiceId: string, input: z.infer<typeof manualReviewSchema>, refundPaymentId?: string) {
  if (!context.internalUserId) return problem(403, "reviewer_required", "An authenticated finance reviewer is required.");
  const kind = refundPaymentId ? "refund" : "receipt";
  const fingerprint = createHash("sha256").update(JSON.stringify({ invoiceId, refundPaymentId, kind, ...input })).digest("hex");
  return withTenant(createDatabase(), context.organisationId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organisationId}:manual-review:${input.requestId}`}))`);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organisationId, context.organisationId))).for("update").limit(1);
    if (!invoice) return problem(404, "invoice_not_found", "Choose an invoice from this practice.");
    const [existing] = await tx.select().from(manualPaymentReviews).where(and(eq(manualPaymentReviews.organisationId, context.organisationId), eq(manualPaymentReviews.requestId, input.requestId))).limit(1);
    if (existing) return existing.fingerprint === fingerprint ? ok(existing, { duplicate: true }) : problem(409, "request_changed", "A verification request cannot be reused with different details.");
    const [reference] = await tx.select({ id: manualPaymentReviews.id }).from(manualPaymentReviews).where(and(eq(manualPaymentReviews.organisationId, context.organisationId), eq(manualPaymentReviews.invoiceId, invoiceId), eq(manualPaymentReviews.kind, kind), eq(manualPaymentReviews.reference, input.reference))).limit(1);
    if (reference) return problem(409, "reference_recorded", "This external reference has already been verified for this invoice.");
    if (["draft", "void"].includes(invoice.status)) return problem(409, "invoice_not_collectible", "Issue the invoice before recording a receipt or refund.");
    if (invoice.quoteId) {
      const [quote] = await tx.select({ status: customerQuotes.status }).from(customerQuotes).where(and(eq(customerQuotes.id, invoice.quoteId), eq(customerQuotes.organisationId, context.organisationId))).limit(1);
      if (!quote || quote.status !== "converted" && !refundPaymentId) return problem(409, "instruction_required", "Complete the quote instruction workflow before recording an external invoice payment.");
    }
    const payments = await tx.select().from(clientPayments).where(and(eq(clientPayments.invoiceId, invoiceId), eq(clientPayments.organisationId, context.organisationId)));
    const currentBalance = await invoiceBalance(tx, invoice);
    const outstanding = currentBalance.outstandingMinor;
    let payment;
    if (refundPaymentId) {
      const current = payments.find(p => p.id === refundPaymentId);
      if (!current || !["manual", "manual_balance", "manual_deposit"].includes(current.purpose) || current.stripePaymentIntentId || current.stripeCheckoutSessionId) return problem(409, "external_refund_required", "Only an externally verified manual payment may use this refund verification.");
      if (!current.succeededAt || input.amountMinor > current.amountMinor-current.refundedMinor) return problem(409, "refund_exceeds_receipt", "The verified refund exceeds the remaining manual receipt.");
      const refundedMinor = current.refundedMinor + input.amountMinor;
      [payment] = await tx.update(clientPayments).set({ refundedMinor, status: refundedMinor === current.amountMinor ? "refunded" : "partially_refunded", updatedAt: new Date() }).where(eq(clientPayments.id, current.id)).returning();
    } else {
      if (input.expectedOutstandingMinor !== outstanding) return problem(409, "invoice_changed", "Reload the invoice and review its current outstanding amount.");
      if (input.amountMinor > outstanding) return problem(409, "receipt_exceeds_balance", "The verified receipt exceeds the outstanding invoice amount.");
      const [pendingCheckout] = await tx.select({ id: clientPayments.id }).from(clientPayments).where(and(eq(clientPayments.invoiceId, invoiceId), inArray(clientPayments.status, ["pending"]), inArray(clientPayments.purpose, ["deposit", "balance"]))).limit(1);
      if (pendingCheckout) return problem(409, "checkout_pending", "Resolve the existing online Checkout before recording an external receipt.");
      [payment] = await tx.insert(clientPayments).values({ organisationId: context.organisationId, invoiceId, quoteId: invoice.quoteId, purpose: invoice.quoteId && invoice.number.endsWith("-B") ? "manual_balance" : invoice.quoteId && invoice.number.endsWith("-D") ? "manual_deposit" : "manual", currency: invoice.currency, amountMinor: input.amountMinor, status: "succeeded", succeededAt: new Date(input.occurredAt) }).returning();
    }
    const [review] = await tx.insert(manualPaymentReviews).values({ organisationId: context.organisationId, invoiceId, paymentId: payment.id, requestId: input.requestId, kind, method: input.method, reference: input.reference, evidence: input.evidence, amountMinor: input.amountMinor, occurredAt: new Date(input.occurredAt), fingerprint, verifiedByUserId: context.internalUserId! }).returning();
    await refreshInvoiceBalance(tx, invoice, new Date(input.occurredAt));
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: `manual_payment.${kind}_verified`, resourceType: "client_payment", resourceId: payment.id, metadata: { reviewId: review.id, invoiceId, reference: review.reference, amountMinor: review.amountMinor, currency: invoice.currency, method: review.method } }));
    // The funds moved outside Surveynt, so no platform payout liability is created.
    return ok(review, { externallyCompleted: true, fundsTransferred: false });
  });
}

export const manualDepositSchema = manualReviewSchema.and(z.object({ version: z.number().int().positive() }));

export async function recordManualDeposit(context: Context, quoteId: string, input: z.infer<typeof manualDepositSchema>) {
  if (!context.internalUserId) return problem(403, "reviewer_required", "An authenticated finance reviewer is required.");
  const fingerprint = createHash("sha256").update(JSON.stringify({ quoteId, kind: "deposit", ...input })).digest("hex");
  return withTenant(createDatabase(), context.organisationId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organisationId}:manual-review:${input.requestId}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`quote-payment:${context.organisationId}:${quoteId}:deposit`}))`);
    const [quote] = await tx.select().from(customerQuotes).where(and(eq(customerQuotes.id, quoteId), eq(customerQuotes.organisationId, context.organisationId))).for("update").limit(1);
    if (!quote) return problem(404, "quote_not_found", "Choose a quote from this practice.");
    const [existing] = await tx.select().from(manualPaymentReviews).where(and(eq(manualPaymentReviews.organisationId, context.organisationId), eq(manualPaymentReviews.requestId, input.requestId))).limit(1);
    if (existing) return existing.fingerprint === fingerprint ? ok(existing, { duplicate: true, jobId: quote.jobId, fundsTransferred: false }) : problem(409, "request_changed", "A verification request cannot be reused with different details.");
    if (quote.version !== input.version || quote.status !== "accepted" || quote.jobId || !quote.acceptedAt || !quote.propertyAddress || !quote.city || !quote.postcode || quote.expiresAt <= new Date()) return problem(409, "quote_changed", "Reload the quote. A current accepted quote with its confirmed property address is required.");
    if (quote.depositMinor <= 0) return problem(409, "deposit_not_required", "This quote does not require a deposit.");
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.organisationId, context.organisationId), eq(invoices.quoteId, quoteId), eq(invoices.number, `${quote.reference}-D`))).for("update").limit(1);
    if (invoice && ["void", "draft"].includes(invoice.status)) return problem(409, "invoice_not_collectible", "Review the deposit invoice before verifying an external receipt.");
    const balance = invoice ? await invoiceBalance(tx, invoice) : { outstandingMinor: quote.depositMinor };
    if (input.expectedOutstandingMinor !== balance.outstandingMinor) return problem(409, "invoice_changed", "Reload the remaining deposit before reviewing this receipt.");
    if (input.amountMinor > balance.outstandingMinor) return problem(409, "receipt_exceeds_balance", "The receipt exceeds the remaining required deposit.");
    if (invoice) {
      const [pending] = await tx.select({ id: clientPayments.id }).from(clientPayments).where(and(eq(clientPayments.invoiceId, invoice.id), eq(clientPayments.status, "pending"), inArray(clientPayments.purpose, ["deposit", "balance"]))).limit(1);
      if (pending) return problem(409, "checkout_pending", "Resolve the online Checkout before recording an external deposit.");
      const [reference] = await tx.select({ id: manualPaymentReviews.id }).from(manualPaymentReviews).where(and(eq(manualPaymentReviews.invoiceId, invoice.id), eq(manualPaymentReviews.kind, "receipt"), eq(manualPaymentReviews.reference, input.reference))).limit(1);
      if (reference) return problem(409, "reference_recorded", "This external reference has already been verified for this deposit.");
    }
    const depositInvoice = invoice ?? await ensureQuoteInvoice(tx, quote, "deposit");
    const [payment] = await tx.insert(clientPayments).values({ organisationId: context.organisationId, invoiceId: depositInvoice.id, quoteId, purpose: "manual_deposit", currency: quote.currency, amountMinor: input.amountMinor, status: "succeeded", succeededAt: new Date(input.occurredAt) }).returning();
    const [review] = await tx.insert(manualPaymentReviews).values({ organisationId: context.organisationId, invoiceId: depositInvoice.id, paymentId: payment.id, requestId: input.requestId, kind: "receipt", method: input.method, reference: input.reference, evidence: input.evidence, amountMinor: input.amountMinor, occurredAt: new Date(input.occurredAt), fingerprint, verifiedByUserId: context.internalUserId! }).returning();
    const updatedBalance = await refreshInvoiceBalance(tx, depositInvoice, new Date(input.occurredAt));
    const jobId = updatedBalance.outstandingMinor === 0 ? await instructPaidQuote(tx, quote, depositInvoice.id, payment.id, context.internalUserId!) : null;
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "manual_payment.receipt_verified", resourceType: "client_payment", resourceId: payment.id, metadata: { reviewId: review.id, invoiceId: depositInvoice.id, quoteId, jobId, reference: input.reference, amountMinor: input.amountMinor, currency: quote.currency, method: input.method } }));
    return ok(review, { externallyCompleted: true, fundsTransferred: false, jobId, outstandingMinor: updatedBalance.outstandingMinor });
  });
}
