import { and, eq, inArray } from "drizzle-orm";
import { clientPayments, invoiceCredits, invoices, type TenantTransaction } from "@surveynt/db";

export async function invoiceBalance(tx: TenantTransaction, invoice: typeof invoices.$inferSelect) {
  const [payments, credits] = await Promise.all([
    tx.select().from(clientPayments).where(and(eq(clientPayments.invoiceId, invoice.id), eq(clientPayments.organisationId, invoice.organisationId), inArray(clientPayments.status, ["succeeded", "partially_refunded", "refunded"]))),
    tx.select().from(invoiceCredits).where(and(eq(invoiceCredits.invoiceId, invoice.id), eq(invoiceCredits.organisationId, invoice.organisationId))),
  ]);
  const receivedMinor = payments.reduce((sum,p) => sum+p.amountMinor-p.refundedMinor,0);
  const creditedMinor = credits.reduce((sum,c) => sum+c.amountMinor,0);
  const creditedVatMinor = credits.reduce((sum,c) => sum+c.vatMinor,0);
  const adjustedTotalMinor = Math.max(0,invoice.totalMinor-creditedMinor);
  return { credits, receivedMinor, creditedMinor, creditedVatMinor, adjustedTotalMinor, outstandingMinor: ["draft","void"].includes(invoice.status)?0:Math.max(0,adjustedTotalMinor-receivedMinor), overpaidMinor: Math.max(0,receivedMinor-adjustedTotalMinor) };
}

export async function refreshInvoiceBalance(tx: TenantTransaction, invoice: typeof invoices.$inferSelect, verifiedAt = new Date()) {
  const balance = await invoiceBalance(tx, invoice);
  if (!["draft","void"].includes(invoice.status)) await tx.update(invoices).set({ status: balance.outstandingMinor===0 ? "paid" : balance.receivedMinor>0 ? "part_paid" : "open", paidAt: balance.outstandingMinor===0 && balance.receivedMinor>0 ? invoice.paidAt??verifiedAt : null, updatedAt: new Date() }).where(and(eq(invoices.id,invoice.id),eq(invoices.organisationId,invoice.organisationId)));
  return balance;
}
