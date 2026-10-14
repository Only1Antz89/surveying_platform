import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { clients, createDatabase, customerQuotes, invoiceLineItems, invoices, jobs, withTenant } from "@surveynt/db";
import { csvCell } from "./tenant-csv";

// Issued invoices in the import layouts used by common accounting packages, so a
// practice can bring Surveynt invoices into its books before a direct link exists.

export type AccountingFormat = "xero" | "quickbooks";
const pounds = (minor: number) => (minor / 100).toFixed(2);
const ukDate = (value: Date) => value.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
const taxType = (basisPoints: number, format: AccountingFormat) => format === "xero" ? (basisPoints === 2000 ? "20% (VAT on Income)" : basisPoints === 500 ? "5% (VAT on Income)" : basisPoints === 0 ? "Zero Rated Income" : `${basisPoints / 100}%`) : (basisPoints === 2000 ? "20.0% S" : basisPoints === 500 ? "5.0% R" : basisPoints === 0 ? "0.0% Z" : `${basisPoints / 100}%`);

export const accountingColumns: Record<AccountingFormat, string[]> = {
  xero: ["*ContactName", "EmailAddress", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "*Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "Currency"],
  quickbooks: ["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount", "ItemTaxCode", "Currency"],
};

export type ExportLine = { contact: string; email: string | null; number: string; reference: string | null; issuedAt: Date; dueAt: Date | null; description: string; quantity: number; unitAmountMinor: number; vatBasisPoints: number; currency: string };

/** Pure row mapping, tested without a database. Unit amounts are VAT-exclusive. */
export function accountingRows(lines: ExportLine[], format: AccountingFormat, accountCode = "200") {
  return lines.map((line) => format === "xero"
    ? [line.contact, line.email ?? "", line.number, line.reference ?? "", ukDate(line.issuedAt), ukDate(line.dueAt ?? line.issuedAt), line.description, line.quantity, pounds(line.unitAmountMinor), accountCode, taxType(line.vatBasisPoints, format), line.currency]
    : [line.number, line.contact, ukDate(line.issuedAt), ukDate(line.dueAt ?? line.issuedAt), "Survey services", line.description, line.quantity, pounds(line.unitAmountMinor), pounds(line.unitAmountMinor * line.quantity), taxType(line.vatBasisPoints, format), line.currency]);
}

export const toCsv = (columns: string[], rows: unknown[][]) => [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

export async function accountingExport(organisationId: string, format: AccountingFormat, range: { from?: Date; to?: Date }) {
  return withTenant(createDatabase(), organisationId, async (tx) => {
    const issued = await tx.select({ invoice: invoices, quoteFirst: customerQuotes.firstName, quoteLast: customerQuotes.lastName, quoteEmail: customerQuotes.email, client: clients.displayName, clientEmail: clients.email, jobReference: jobs.reference }).from(invoices)
      .leftJoin(jobs, and(eq(jobs.id, invoices.jobId), eq(jobs.organisationId, invoices.organisationId)))
      .leftJoin(clients, and(eq(clients.id, jobs.clientId), eq(clients.organisationId, invoices.organisationId)))
      .leftJoin(customerQuotes, and(eq(customerQuotes.id, invoices.quoteId), eq(customerQuotes.organisationId, invoices.organisationId)))
      .where(and(eq(invoices.organisationId, organisationId), isNotNull(invoices.issuedAt), ne(invoices.status, "void"), range.from ? gte(invoices.issuedAt, range.from) : undefined, range.to ? lt(invoices.issuedAt, range.to) : undefined)).orderBy(asc(invoices.issuedAt)).limit(5000);
    const items = issued.length ? await tx.select().from(invoiceLineItems).where(and(eq(invoiceLineItems.organisationId, organisationId), inArray(invoiceLineItems.invoiceId, issued.map((row) => row.invoice.id)))).orderBy(asc(invoiceLineItems.createdAt)) : [];
    const lines: ExportLine[] = issued.flatMap((row) => {
      const contact = row.client ?? ([row.quoteFirst, row.quoteLast].filter(Boolean).join(" ") || "Customer");
      const base = { contact, email: row.clientEmail ?? row.quoteEmail, number: row.invoice.number, reference: row.jobReference, issuedAt: row.invoice.issuedAt!, dueAt: row.invoice.dueAt, currency: row.invoice.currency };
      const own = items.filter((item) => item.invoiceId === row.invoice.id);
      return own.length ? own.map((item) => ({ ...base, description: item.description, quantity: item.quantity, unitAmountMinor: item.unitAmountMinor, vatBasisPoints: item.vatBasisPoints })) : [{ ...base, description: "Survey services", quantity: 1, unitAmountMinor: row.invoice.subtotalMinor, vatBasisPoints: row.invoice.subtotalMinor ? Math.round(row.invoice.vatMinor / row.invoice.subtotalMinor * 10000) : 0 }];
    });
    return { csv: toCsv(accountingColumns[format], accountingRows(lines, format)), invoices: issued.length };
  });
}
