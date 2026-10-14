import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, clients, createDatabase, customerQuotes, invoiceLineItems, invoices, engagementAcceptances, engagementTerms, jobs, organisationOperationalSettings, organisations, properties, reportApprovals, reportVersions, withTenant, type TenantTransaction } from "@surveynt/db";
import type { ComposedReport } from "@surveynt/assistant";
import { BrandedDocument, longDate, money, type Brand } from "./branded-pdf";
import { assignedJobScope } from "./workspace-scope";
import { workspaceAudit } from "./workspace-audit";
import { readPublicQuote } from "./firm-operations";
import { approvedReportIsCurrent } from "./reports";
import type { AccommodationSchedule } from "./floor-plan-model";
import type { OrganisationRole } from "@surveynt/domain";

type Context = { organisationId: string; internalUserId: string | null; role: OrganisationRole; actorRole?: OrganisationRole; workspaceMode?: import("./workspace-mode").WorkspaceMode };
export class DocumentError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

export async function practiceBrand(tx: TenantTransaction, organisationId: string): Promise<Brand> {
  const [[org], [settings]] = await Promise.all([
    tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, organisationId)).limit(1),
    tx.select({ identity: organisationOperationalSettings.reportIdentity, branding: organisationOperationalSettings.customerBranding }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, organisationId)).limit(1),
  ]);
  return { name: settings?.identity.companyName || settings?.branding.displayName || org?.name || "Surveying practice", accent: settings?.branding.accentColour ?? null, address: settings?.identity.address ?? null, email: settings?.identity.email ?? null, phone: settings?.identity.phone ?? null };
}

type QuoteRow = typeof customerQuotes.$inferSelect;
export async function renderQuote(brand: Brand, quote: QuoteRow) {
  const pricing = quote.pricingSnapshot as Record<string, unknown>;
  const service = typeof pricing.service === "string" ? pricing.service : "Property survey";
  const pdf = await BrandedDocument.create(brand, `Quote ${quote.reference}`, { subject: service, watermark: ["cancelled", "expired"].includes(quote.status) ? quote.status.toUpperCase() : null });
  pdf.heading(`Quote ${quote.reference}`, 1).paragraph(service, { size: 12, bold: true });
  pdf.details([
    ["Prepared for", [quote.firstName, quote.lastName].filter(Boolean).join(" ") || "Client"],
    ["Property", [quote.propertyAddress, quote.city, quote.postcode].filter(Boolean).join(", ") || "To be confirmed"],
    ["Issued", longDate(quote.issuedAt ?? quote.createdAt)],
    ["Valid until", longDate(quote.expiresAt)],
  ]);
  pdf.table([{ label: "Item", width: 3 }, { label: "Amount", width: 1, align: "right" }], [
    { cells: [service, money(quote.subtotalMinor, quote.currency)] },
    { cells: ["VAT", money(quote.vatMinor, quote.currency)] },
    { cells: ["Total", money(quote.totalMinor, quote.currency)], bold: true },
    { cells: ["Deposit to book", money(quote.depositMinor, quote.currency)] },
  ]);
  pdf.paragraph("To accept, use the secure link in your quote email. The deposit secures your appointment; the balance is due before the report is released.", { muted: true });
  return pdf.finish(`${brand.name} · Quote ${quote.reference}`);
}

/** Practice copy of a quote. */
export async function practiceQuotePdf(context: Context, quoteId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [quote] = await tx.select().from(customerQuotes).where(and(eq(customerQuotes.id, quoteId), eq(customerQuotes.organisationId, context.organisationId))).limit(1);
    if (!quote) return null;
    return { bytes: await renderQuote(await practiceBrand(tx, context.organisationId), quote), filename: `quote-${quote.reference}.pdf` };
  });
}

/** Client copy of their quote through the secure case link. */
export async function publicQuotePdf(quoteId: string, token: string) {
  const found = await readPublicQuote(quoteId, token);
  if (!found) return null;
  return withTenant(createDatabase(process.env.DATABASE_ADMIN_URL), found.row.organisationId, async (tx) => ({ bytes: await renderQuote(await practiceBrand(tx, found.row.organisationId), found.row), filename: `quote-${found.row.reference}.pdf` }));
}

export async function renderSignedTerms(tx: TenantTransaction, organisationId: string, jobId: string) {
  const [row] = await tx.select({ acceptance: engagementAcceptances, terms: engagementTerms, reference: jobs.reference }).from(engagementAcceptances)
    .innerJoin(engagementTerms, and(eq(engagementTerms.id, engagementAcceptances.termsId), eq(engagementTerms.organisationId, engagementAcceptances.organisationId)))
    .innerJoin(jobs, and(eq(jobs.id, engagementAcceptances.jobId), eq(jobs.organisationId, engagementAcceptances.organisationId)))
    .where(and(eq(engagementAcceptances.organisationId, organisationId), eq(engagementAcceptances.jobId, jobId))).orderBy(desc(engagementAcceptances.signedAt)).limit(1);
  if (!row) return null;
  const brand = await practiceBrand(tx, organisationId);
  const pdf = await BrandedDocument.create(brand, `${row.terms.title} - signed`, { subject: `Job ${row.reference}` });
  pdf.heading(row.terms.title, 1).paragraph(`Version ${row.terms.version} · Job ${row.reference}`, { muted: true });
  for (const paragraph of row.terms.body.split(/\n{2,}/)) pdf.paragraph(paragraph);
  pdf.spacer(6).heading("Signature");
  pdf.details([
    ["Signed by", row.acceptance.signerName],
    ["Date", longDate(row.acceptance.signedAt)],
    ["Method", row.acceptance.method === "typed_signature" ? "Typed name in the client case page" : "Signed copy held by the practice"],
    ["Wording fingerprint", row.acceptance.termsSha256],
  ]);
  pdf.paragraph("The fingerprint is a SHA-256 digest of the exact title and wording signed. Any change to the wording produces a different fingerprint.", { size: 8, muted: true });
  return { bytes: await pdf.finish(`${brand.name} · Signed terms · ${row.reference}`), filename: `signed-terms-${row.reference}.pdf` };
}

export async function practiceSignedTermsPdf(context: Context, jobId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    return job ? renderSignedTerms(tx, context.organisationId, jobId) : null;
  });
}

export async function publicSignedTermsPdf(quoteId: string, token: string) {
  const found = await readPublicQuote(quoteId, token);
  if (!found?.row.jobId) return null;
  return withTenant(createDatabase(process.env.DATABASE_ADMIN_URL), found.row.organisationId, (tx) => renderSignedTerms(tx, found.row.organisationId, found.row.jobId!));
}

/** The practice's own report layout from the latest composed version. Only an approved, current version prints without the review watermark. */
export async function practiceReportPdf(context: Context, surveyId: string, options: { requireFinal?: boolean } = {}) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.select({ version: reportVersions, reference: jobs.reference, approvedAt: reportApprovals.createdAt }).from(reportVersions)
      .innerJoin(jobs, and(eq(jobs.id, reportVersions.jobId), eq(jobs.organisationId, reportVersions.organisationId)))
      .leftJoin(reportApprovals, eq(reportApprovals.reportVersionId, reportVersions.id))
      .where(and(eq(reportVersions.surveyId, surveyId), eq(reportVersions.organisationId, context.organisationId), assignedJobScope(context))).orderBy(desc(reportVersions.versionNumber)).limit(1);
    if (!row) return null;
    if (row.version.content.retentionRemoved === true) throw new DocumentError(410, "content_removed", "This report's content was removed under the retention policy.");
    const report = row.version.content as unknown as ComposedReport & { accommodation?: AccommodationSchedule };
    const approval = row.approvedAt ? await approvedReportIsCurrent(tx, context, surveyId) : null;
    const final = Boolean(approval?.current && approval.versionNumber === row.version.versionNumber);
    if (options.requireFinal && !final) throw new DocumentError(409, "not_final", "The report has not been signed off yet.");
    const brand = await practiceBrand(tx, context.organisationId);
    const pdf = await BrandedDocument.create(brand, report.title, { watermark: final ? null : "REVIEW COPY", subject: report.jobReference });
    pdf.heading(report.title, 1).details([
      ["Property", [report.property.line1, report.property.city, report.property.postcode].filter(Boolean).join(", ")],
      ["Reference", report.jobReference],
      ["Version", `${row.version.versionNumber}${final ? ` · signed off ${longDate(row.approvedAt!)}` : " · not yet signed off"}`],
    ]);
    if (report.ratingSummary.length) { pdf.heading("Condition summary"); pdf.table([{ label: "Rating", width: 1 }, { label: "Elements", width: 3 }], report.ratingSummary.map((group) => ({ cells: [group.label, group.elements.map((element) => element.title).join(", ")] }))); }
    for (const section of report.sections) {
      if (!section.blocks.length && !section.elements.length) continue;
      pdf.heading(section.title);
      for (const block of section.blocks) pdf.paragraph(block.text);
      for (const element of section.elements) { pdf.paragraph(element.title, { bold: true }); for (const block of element.blocks) pdf.paragraph(block.text); }
    }
    if (report.accommodation) {
      pdf.heading("Accommodation and measurements");
      pdf.table([{ label: "Room", width: 2 }, { label: "Dimensions", width: 2 }, { label: "Area", width: 1, align: "right" }], report.accommodation.floors.flatMap((floor) => [{ cells: [floor.label, "", `${floor.areaM2} m²`], bold: true }, ...floor.rooms.map((room) => ({ cells: [room.name, room.dimensions ?? "Not measured", room.areaM2 != null ? `${room.areaM2} m²` : "-"] }))]).concat([{ cells: ["Total measured", "", `${report.accommodation.totalAreaM2} m² (${report.accommodation.totalAreaSqFt} sq ft)`], bold: true }]));
      pdf.paragraph(report.accommodation.basis, { size: 8, muted: true });
    }
    if (report.recommendations.length) { pdf.heading("Recommendations"); for (const block of report.recommendations) pdf.paragraph(block.text); }
    if (!final) pdf.paragraph("Review copy. This version has not been signed off by the surveyor, or the survey has changed since sign-off. Do not issue.", { muted: true, bold: true });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "report.practice_pdf_generated", resourceType: "report_version", resourceId: row.version.id, metadata: { final } }));
    return { bytes: await pdf.finish(`${brand.name} · ${report.jobReference} · version ${row.version.versionNumber}${final ? "" : " · review copy"}`), filename: `${report.jobReference}-v${row.version.versionNumber}${final ? "" : "-review"}.pdf` };
  });
}

export const letterInput = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(10).max(12000), recipient: z.enum(["client"]).default("client") });

/** A letter to the job's client on practice letterhead. Generated on demand and audited; nothing is sent. */
export async function jobLetterPdf(context: Context, jobId: string, input: z.infer<typeof letterInput>) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.select({ reference: jobs.reference, client: clients.displayName, line1: properties.line1, city: properties.city, postcode: properties.postcode }).from(jobs)
      .innerJoin(clients, and(eq(clients.id, jobs.clientId), eq(clients.organisationId, jobs.organisationId)))
      .innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, jobs.organisationId)))
      .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!row) return null;
    const brand = await practiceBrand(tx, context.organisationId);
    const pdf = await BrandedDocument.create(brand, input.subject, { subject: `Job ${row.reference}` });
    pdf.paragraph(longDate(new Date()), { muted: true }).paragraph(row.client, { bold: true }).paragraph(`Our reference: ${row.reference}`, { muted: true });
    pdf.heading(input.subject).paragraph(`Property: ${[row.line1, row.city, row.postcode].filter(Boolean).join(", ")}`, { muted: true });
    for (const paragraph of input.body.split(/\n{2,}/)) pdf.paragraph(paragraph);
    pdf.spacer(10).paragraph("Yours sincerely,").spacer(18).paragraph(brand.name, { bold: true });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "document.letter_generated", resourceType: "job", resourceId: jobId, metadata: { subject: input.subject } }));
    return { bytes: await pdf.finish(`${brand.name} · ${row.reference}`), filename: `letter-${row.reference}.pdf` };
  });
}

/** A branded copy of an issued invoice with its line items and balance. */
export async function renderInvoicePdf(tx: TenantTransaction, organisationId: string, invoiceId: string, jobId: string) {
  const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organisationId, organisationId), eq(invoices.jobId, jobId))).limit(1);
  if (!invoice || !invoice.issuedAt || invoice.status === "draft" || invoice.status === "void") return null;
  const [[job], items] = await Promise.all([
    tx.select({ reference: jobs.reference, client: clients.displayName, line1: properties.line1, city: properties.city, postcode: properties.postcode }).from(jobs).innerJoin(clients, and(eq(clients.id, jobs.clientId), eq(clients.organisationId, jobs.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, jobs.organisationId))).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, organisationId))).limit(1),
    tx.select().from(invoiceLineItems).where(and(eq(invoiceLineItems.organisationId, organisationId), eq(invoiceLineItems.invoiceId, invoiceId))),
  ]);
  const brand = await practiceBrand(tx, organisationId);
  const pdf = await BrandedDocument.create(brand, `Invoice ${invoice.number}`, { subject: job?.reference, watermark: invoice.status === "paid" ? "PAID" : null });
  pdf.heading(`Invoice ${invoice.number}`, 1).details([
    ["Billed to", job?.client ?? "Client"],
    ["Property", [job?.line1, job?.city, job?.postcode].filter(Boolean).join(", ")],
    ["Our reference", job?.reference ?? ""],
    ["Issued", longDate(invoice.issuedAt)],
    ["Due", invoice.dueAt ? longDate(invoice.dueAt) : "On receipt"],
  ]);
  const lines = items.length ? items.map((item) => ({ cells: [item.description, String(item.quantity), money(item.unitAmountMinor, invoice.currency), money(item.unitAmountMinor * item.quantity, invoice.currency)] })) : [{ cells: ["Survey services", "1", money(invoice.subtotalMinor, invoice.currency), money(invoice.subtotalMinor, invoice.currency)] }];
  pdf.table([{ label: "Description", width: 4 }, { label: "Qty", width: 1, align: "right" }, { label: "Unit", width: 1.5, align: "right" }, { label: "Amount", width: 1.5, align: "right" }], [
    ...lines,
    { cells: ["Subtotal", "", "", money(invoice.subtotalMinor, invoice.currency)] },
    { cells: ["VAT", "", "", money(invoice.vatMinor, invoice.currency)] },
    { cells: ["Total", "", "", money(invoice.totalMinor, invoice.currency)], bold: true },
  ]);
  pdf.paragraph(invoice.status === "paid" ? "Paid in full. Thank you." : "Please pay using the link in your client portal or by the method agreed with the practice.", { muted: true });
  return { bytes: await pdf.finish(`${brand.name} · Invoice ${invoice.number}`), filename: `invoice-${invoice.number}.pdf` };
}

