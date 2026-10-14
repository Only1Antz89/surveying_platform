import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, auditEvents, backgroundJobs, clientCasePublications, clientPortalAccess, clientPortalFiles, clients, createDatabase, customerQuotes, engagementAcceptances, engagementTerms, invoices, jobStageEvents, jobs, mediaAssets, organisationOperationalSettings, organisations, properties, reportApprovals, reportVersions, surveys, withTenant, type TenantTransaction } from "@surveynt/db";
import { isManagementRole, type OrganisationRole } from "@surveynt/domain";
import { applicationUrl } from "./email";
import { enqueueEmail } from "./email-queue";
import { readPublicQuote } from "./firm-operations";
import { workspaceAudit } from "./workspace-audit";
import { assignedJobScope } from "./workspace-scope";
import { approvedReportIsCurrent } from "./reports";
import { surveyFileRetentionExpiry } from "./survey-file-retention";
import { getObjectStorage } from "./storage";
import { verifiedSurveyFileOriginalRemoval } from "./survey-file-original-removal-status";
import { portalProgress, safeAccent, type PortalDocument, type PortalView } from "./client-portal-model";

// The client portal. A client reaches it with either their portal link (sent by the
// practice or after accepting a quote) or their existing quote link. Everything shown is
// either already client-facing (quote, invoices, signed terms, issued reports) or
// explicitly shared by the practice (photos, certificates, documents, property information).

export class PortalError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export type PortalCredential = { via: "portal" | "quote"; id: string; token: string };
type Context = { organisationId: string; internalUserId: string | null; role: OrganisationRole; actorRole?: OrganisationRole; workspaceMode?: import("./workspace-mode").WorkspaceMode };
type Session = { organisationId: string; jobId: string; accessId: string | null; quoteId: string | null };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const adminDb = () => { if (!process.env.DATABASE_ADMIN_URL) throw new PortalError(503, "portal_unavailable", "The client portal is not configured."); return createDatabase(process.env.DATABASE_ADMIN_URL); };
const portalLifetimeMs = 548 * 86_400_000;
export const portalUrl = (accessId: string, token: string) => `${applicationUrl()}/portal/${accessId}#${token}`;

/** Resolves a credential to one job. Unknown, revoked and expired links all fail the same way. */
export async function resolvePortal(credential: PortalCredential): Promise<Session | null> {
  if (!uuid.test(credential.id) || !credential.token || credential.token.length > 200) return null;
  if (credential.via === "quote") {
    const found = await readPublicQuote(credential.id, credential.token);
    if (!found?.row.jobId || found.row.status !== "converted") return null;
    return { organisationId: found.row.organisationId, jobId: found.row.jobId, accessId: null, quoteId: found.row.id };
  }
  const db = adminDb();
  const [row] = await db.select({ access: clientPortalAccess, status: organisations.status }).from(clientPortalAccess).innerJoin(organisations, eq(organisations.id, clientPortalAccess.organisationId))
    .where(and(eq(clientPortalAccess.id, credential.id), eq(clientPortalAccess.tokenHash, hash(credential.token)), isNull(clientPortalAccess.revokedAt), gt(clientPortalAccess.expiresAt, new Date()))).limit(1);
  if (!row || row.status !== "active") return null;
  if (!row.access.lastViewedAt || Date.now() - row.access.lastViewedAt.getTime() > 10 * 60_000) await db.update(clientPortalAccess).set({ lastViewedAt: new Date() }).where(eq(clientPortalAccess.id, row.access.id));
  return { organisationId: row.access.organisationId, jobId: row.access.jobId, accessId: row.access.id, quoteId: null };
}

async function requireSession(credential: PortalCredential) {
  const session = await resolvePortal(credential);
  if (!session) throw new PortalError(404, "portal_not_found", "This portal link is invalid, has been replaced or has expired. Ask your surveyor for a new link.");
  return session;
}

/** The latest signed-off report for the job, if it is issued, current and within the client access period. */
async function issuedReport(tx: TenantTransaction, organisationId: string, jobId: string, stage: string) {
  if (!["issued", "paid", "archived"].includes(stage)) return { available: false as const, reason: "Available once the report is issued." };
  const [survey] = await tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.organisationId, organisationId), eq(surveys.jobId, jobId), eq(surveys.status, "approved"))).orderBy(desc(surveys.createdAt)).limit(1);
  if (!survey) return { available: false as const, reason: "Available once the report is issued." };
  const [record] = await tx.select({ id: reportVersions.id, approvedAt: reportApprovals.createdAt, removed: sql<boolean>`coalesce((${reportVersions.content}->>'retentionRemoved')::boolean, false)` }).from(reportVersions).innerJoin(reportApprovals, eq(reportApprovals.reportVersionId, reportVersions.id)).where(and(eq(reportVersions.organisationId, organisationId), eq(reportVersions.surveyId, survey.id))).orderBy(desc(reportVersions.versionNumber)).limit(1);
  if (!record) return { available: false as const, reason: "Available once the report is issued." };
  const expires = surveyFileRetentionExpiry(record.approvedAt);
  if (record.removed) return { available: false as const, reason: "The report was removed after the retention period." };
  if (expires <= new Date()) return { available: false as const, reason: "Online access ended one year after issue. Contact the practice for a copy." };
  const current = await approvedReportIsCurrent(tx, { organisationId }, survey.id);
  if (!current.current) return { available: false as const, reason: "The report is being updated and will be reissued." };
  return { available: true as const, surveyId: survey.id, reportVersionId: record.id, expiresAt: expires.toISOString() };
}

export async function portalView(credential: PortalCredential): Promise<PortalView> {
  const session = await requireSession(credential);
  return withTenant(adminDb(), session.organisationId, async (tx) => {
    const [row] = await tx.select({ job: jobs, line1: properties.line1, line2: properties.line2, city: properties.city, postcode: properties.postcode, propertyType: properties.propertyType, organisationName: organisations.name })
      .from(jobs).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, jobs.organisationId))).innerJoin(organisations, eq(organisations.id, jobs.organisationId))
      .where(and(eq(jobs.id, session.jobId), eq(jobs.organisationId, session.organisationId))).limit(1);
    if (!row) throw new PortalError(404, "portal_not_found", "This case is no longer available.");
    const [[settings], events, [appointment], [publication], invoiceRows, files, [quote], [terms], [acceptance], report] = await Promise.all([
      tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, session.organisationId)).limit(1),
      tx.select({ toStage: jobStageEvents.toStage, at: jobStageEvents.createdAt }).from(jobStageEvents).where(and(eq(jobStageEvents.organisationId, session.organisationId), eq(jobStageEvents.jobId, session.jobId))).orderBy(asc(jobStageEvents.createdAt)).limit(200),
      tx.select().from(appointments).where(and(eq(appointments.organisationId, session.organisationId), eq(appointments.jobId, session.jobId), ne(appointments.status, "cancelled"))).orderBy(desc(appointments.startsAt)).limit(1),
      tx.select().from(clientCasePublications).where(and(eq(clientCasePublications.organisationId, session.organisationId), eq(clientCasePublications.jobId, session.jobId))).limit(1),
      tx.select().from(invoices).where(and(eq(invoices.organisationId, session.organisationId), eq(invoices.jobId, session.jobId), ne(invoices.status, "draft"), ne(invoices.status, "void"))).orderBy(asc(invoices.createdAt)),
      tx.select({ id: clientPortalFiles.id, category: clientPortalFiles.category, title: clientPortalFiles.title, sharedAt: clientPortalFiles.sharedAt, contentType: mediaAssets.contentType }).from(clientPortalFiles).innerJoin(mediaAssets, and(eq(mediaAssets.id, clientPortalFiles.mediaAssetId), eq(mediaAssets.organisationId, clientPortalFiles.organisationId), eq(mediaAssets.status, "stored")))
        .where(and(eq(clientPortalFiles.organisationId, session.organisationId), eq(clientPortalFiles.jobId, session.jobId), isNull(clientPortalFiles.revokedAt))).orderBy(asc(clientPortalFiles.sharedAt)),
      tx.select({ id: customerQuotes.id }).from(customerQuotes).where(and(eq(customerQuotes.organisationId, session.organisationId), eq(customerQuotes.jobId, session.jobId))).limit(1),
      tx.select().from(engagementTerms).where(and(eq(engagementTerms.organisationId, session.organisationId), eq(engagementTerms.status, "published"))).orderBy(desc(engagementTerms.version)).limit(1),
      tx.select({ acceptance: engagementAcceptances, version: engagementTerms.version }).from(engagementAcceptances).innerJoin(engagementTerms, and(eq(engagementTerms.id, engagementAcceptances.termsId), eq(engagementTerms.organisationId, engagementAcceptances.organisationId))).where(and(eq(engagementAcceptances.organisationId, session.organisationId), eq(engagementAcceptances.jobId, session.jobId))).orderBy(desc(engagementAcceptances.signedAt)).limit(1),
      issuedReport(tx, session.organisationId, session.jobId, row.job.stage),
    ]);
    const issued = invoiceRows.filter((invoice) => invoice.issuedAt);
    const reportReason = report.available ? null : report.reason;
    const documents: PortalDocument[] = [
      { key: "rics_report", kind: "report", title: "RICS survey report", description: "Your report in the RICS format, as signed off by your surveyor.", available: report.available, reason: reportReason },
      { key: "practice_report", kind: "report", title: `${settings?.reportIdentity.companyName || row.organisationName} report`, description: "The same findings in the practice's own layout, including room measurements.", available: report.available, reason: reportReason },
      { key: "signed_terms", kind: "contract", title: "Signed terms of engagement", description: acceptance ? `Version ${acceptance.version}, signed by ${acceptance.acceptance.signerName}.` : "The terms you agreed before the survey.", available: Boolean(acceptance), reason: acceptance ? null : terms ? "Not signed yet." : "Your practice has not published online terms." },
      { key: "quote", kind: "quote", title: "Your quote", description: "The fee and service you accepted.", available: Boolean(quote), reason: quote ? null : "This job was arranged directly with the practice." },
    ];
    return {
      brand: { name: settings?.customerBranding.displayName || settings?.reportIdentity.companyName || row.organisationName, logoUrl: settings?.customerBranding.logoUrl?.startsWith("https://") ? settings.customerBranding.logoUrl : null, accent: safeAccent(settings?.customerBranding.accentColour), email: settings?.reportIdentity.email ?? null, phone: settings?.reportIdentity.phone ?? null, address: settings?.reportIdentity.address ?? null },
      job: { reference: row.job.reference, service: row.job.serviceName, stage: row.job.stage },
      property: { address: [row.line1, row.line2, row.city, row.postcode].filter(Boolean).join(", "), propertyType: row.propertyType },
      progress: portalProgress(row.job.stage, events),
      appointment: appointment ? { startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString(), status: appointment.status } : null,
      timezone: settings?.timezone ?? "Europe/London",
      documents,
      invoices: issued.map((invoice) => ({ id: invoice.id, number: invoice.number, status: invoice.status, currency: invoice.currency, totalMinor: invoice.totalMinor, issuedAt: invoice.issuedAt?.toISOString() ?? null, dueAt: invoice.dueAt?.toISOString() ?? null })),
      files: files.map((file) => ({ id: file.id, category: file.category as "photo" | "video" | "certificate" | "document", title: file.title, contentType: file.contentType, sharedAt: file.sharedAt.toISOString() })),
      information: publication?.propertyInformation ?? [],
      terms: { required: Boolean(settings?.engagementTermsRequired && terms), signed: Boolean(acceptance && terms && acceptance.acceptance.termsId === terms.id), version: acceptance?.version ?? null, signedAt: acceptance?.acceptance.signedAt.toISOString() ?? null, signedBy: acceptance?.acceptance.signerName ?? null },
      quoteLink: credential.via === "quote",
      reportAccessExpiresAt: report.available ? report.expiresAt : null,
    };
  });
}

/** Issued report content for reading in the portal. */
export async function portalReport(credential: PortalCredential) {
  const session = await requireSession(credential);
  return withTenant(adminDb(), session.organisationId, async (tx) => {
    const [job] = await tx.select({ stage: jobs.stage }).from(jobs).where(and(eq(jobs.id, session.jobId), eq(jobs.organisationId, session.organisationId))).limit(1);
    const report = await issuedReport(tx, session.organisationId, session.jobId, job?.stage ?? "");
    if (!report.available) throw new PortalError(409, "report_unavailable", report.reason);
    const [version] = await tx.select({ id: reportVersions.id, number: reportVersions.versionNumber, content: reportVersions.content }).from(reportVersions).where(and(eq(reportVersions.id, report.reportVersionId), eq(reportVersions.organisationId, session.organisationId))).limit(1);
    await tx.insert(auditEvents).values({ organisationId: session.organisationId, action: "customer.report_viewed", resourceType: "report_version", resourceId: version.id, metadata: { via: credential.via } });
    return { version: version.number, content: version.content, accessExpiresAt: report.expiresAt };
  });
}

/** A shared photo, video or certificate, streamed only while it remains shared. */
export async function portalFile(credential: PortalCredential, fileId: string) {
  if (!uuid.test(fileId)) throw new PortalError(404, "file_not_found", "This file is no longer shared.");
  const session = await requireSession(credential);
  const media = await withTenant(adminDb(), session.organisationId, async (tx) => {
    const [row] = await tx.select({ media: mediaAssets, title: clientPortalFiles.title }).from(clientPortalFiles).innerJoin(mediaAssets, and(eq(mediaAssets.id, clientPortalFiles.mediaAssetId), eq(mediaAssets.organisationId, clientPortalFiles.organisationId)))
      .where(and(eq(clientPortalFiles.id, fileId), eq(clientPortalFiles.organisationId, session.organisationId), eq(clientPortalFiles.jobId, session.jobId), isNull(clientPortalFiles.revokedAt), eq(mediaAssets.status, "stored"))).limit(1);
    if (!row || await verifiedSurveyFileOriginalRemoval(tx, session.organisationId, "media", row.media.id)) return null;
    return row;
  });
  if (!media) throw new PortalError(404, "file_not_found", "This file is no longer shared.");
  const storage = getObjectStorage();
  const object = storage ? await storage.get(media.media.storageKey) : null;
  if (!object) throw new PortalError(503, "file_unavailable", "The file is temporarily unavailable.");
  return { stream: object.stream, contentType: media.media.contentType, filename: media.media.originalFilename ?? `${media.title}`, size: media.media.byteSize };
}

/** Generated documents: quote, signed terms, invoices and (once issued) both report formats. */
export async function portalDocument(credential: PortalCredential, key: string) {
  const session = await requireSession(credential);
  const documents = await import("./practice-documents");
  const db = adminDb();
  if (key === "quote") {
    const result = await withTenant(db, session.organisationId, async (tx) => {
      const [quote] = await tx.select().from(customerQuotes).where(and(eq(customerQuotes.organisationId, session.organisationId), eq(customerQuotes.jobId, session.jobId))).limit(1);
      return quote ? { bytes: await documents.renderQuote(await documents.practiceBrand(tx, session.organisationId), quote), filename: `quote-${quote.reference}.pdf` } : null;
    });
    if (!result) throw new PortalError(404, "not_available", "No quote is linked to this job.");
    return result;
  }
  if (key === "signed_terms") {
    const result = await withTenant(db, session.organisationId, (tx) => documents.renderSignedTerms(tx, session.organisationId, session.jobId));
    if (!result) throw new PortalError(404, "not_available", "No signed terms are recorded yet.");
    return result;
  }
  if (key.startsWith("invoice:")) {
    const invoiceId = key.slice(8);
    if (!uuid.test(invoiceId)) throw new PortalError(404, "not_available", "The invoice could not be found.");
    const result = await withTenant(db, session.organisationId, (tx) => documents.renderInvoicePdf(tx, session.organisationId, invoiceId, session.jobId));
    if (!result) throw new PortalError(404, "not_available", "The invoice could not be found.");
    return result;
  }
  if (key === "rics_report" || key === "practice_report") {
    const report = await withTenant(db, session.organisationId, async (tx) => {
      const [job] = await tx.select({ stage: jobs.stage }).from(jobs).where(and(eq(jobs.id, session.jobId), eq(jobs.organisationId, session.organisationId))).limit(1);
      return issuedReport(tx, session.organisationId, session.jobId, job?.stage ?? "");
    });
    if (!report.available) throw new PortalError(409, "report_unavailable", report.reason);
    const reader = { organisationId: session.organisationId, internalUserId: null, role: "read_only" as const };
    if (key === "practice_report") {
      const result = await documents.practiceReportPdf(reader, report.surveyId, { requireFinal: true }).catch((error: Error & { status?: number }) => { throw new PortalError(error.status ?? 503, "report_unavailable", error.message); });
      if (!result) throw new PortalError(409, "report_unavailable", "The report is not available yet.");
      return result;
    }
    const { ricsReportPdf, RicsOutputError } = await import("./rics-report-output");
    try { return await ricsReportPdf(reader, report.surveyId, { final: true }); }
    catch (error) { if (error instanceof RicsOutputError) throw new PortalError(error.status === 409 && error.code !== "not_signed_off" ? 409 : error.status, "report_unavailable", error.code === "rics_output_unavailable" || error.code === "licence_configuration_required" ? "The RICS-format PDF is not available from this practice yet. Read the report online or download the practice report." : error.message); throw error; }
  }
  throw new PortalError(404, "not_available", "This document is not available.");
}

// ---------- Practice side ----------

export const shareInput = z.object({ mediaAssetId: z.uuid(), category: z.enum(["photo", "video", "certificate", "document"]), title: z.string().trim().min(1).max(160) });
const canManagePortal = (role: OrganisationRole) => isManagementRole(role) || role === "coordinator";

/** Link status, the client's email, what is shared and the survey media available to share. */
export async function portalAdmin(context: Context, jobId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id, propertyId: jobs.propertyId, clientEmail: clients.email, clientName: clients.displayName }).from(jobs).innerJoin(clients, and(eq(clients.id, jobs.clientId), eq(clients.organisationId, jobs.organisationId))).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!job) return null;
    const [[access], shared, media, [quote]] = await Promise.all([
      tx.select().from(clientPortalAccess).where(and(eq(clientPortalAccess.organisationId, context.organisationId), eq(clientPortalAccess.jobId, jobId), isNull(clientPortalAccess.revokedAt))).limit(1),
      tx.select({ id: clientPortalFiles.id, mediaAssetId: clientPortalFiles.mediaAssetId, category: clientPortalFiles.category, title: clientPortalFiles.title, sharedAt: clientPortalFiles.sharedAt }).from(clientPortalFiles).where(and(eq(clientPortalFiles.organisationId, context.organisationId), eq(clientPortalFiles.jobId, jobId), isNull(clientPortalFiles.revokedAt))).orderBy(asc(clientPortalFiles.sharedAt)),
      tx.select({ id: mediaAssets.id, kind: mediaAssets.kind, originalFilename: mediaAssets.originalFilename, contentType: mediaAssets.contentType, capturedAt: mediaAssets.capturedAt, createdAt: mediaAssets.createdAt, captureContext: mediaAssets.captureContext }).from(mediaAssets).innerJoin(surveys, and(eq(surveys.id, mediaAssets.surveyId), eq(surveys.organisationId, mediaAssets.organisationId)))
        .where(and(eq(mediaAssets.organisationId, context.organisationId), eq(surveys.jobId, jobId), eq(mediaAssets.status, "stored"), eq(mediaAssets.derivation, "original"))).orderBy(desc(mediaAssets.createdAt)).limit(300),
      tx.select({ id: customerQuotes.id }).from(customerQuotes).where(and(eq(customerQuotes.organisationId, context.organisationId), eq(customerQuotes.jobId, jobId))).limit(1),
    ]);
    return {
      clientEmail: job.clientEmail, clientName: job.clientName, hasQuote: Boolean(quote),
      access: access ? { id: access.id, email: access.email, source: access.source, lastSentAt: access.lastSentAt?.toISOString() ?? null, lastViewedAt: access.lastViewedAt?.toISOString() ?? null, expiresAt: access.expiresAt.toISOString(), createdAt: access.createdAt.toISOString() } : null,
      shared: shared.map((item) => ({ ...item, sharedAt: item.sharedAt.toISOString() })),
      media: media.map((item) => ({ id: item.id, kind: item.kind, name: item.originalFilename, contentType: item.contentType, capturedAt: (item.capturedAt ?? item.createdAt).toISOString(), element: (item.captureContext as { elementKey?: string }).elementKey ?? null })),
      canManage: canManagePortal(context.role),
    };
  });
}

async function issueAccess(tx: TenantTransaction, input: { organisationId: string; jobId: string; email: string | null; source: "quote_accepted" | "practice_sent" | "practice_link"; actorUserId: string | null }) {
  await tx.update(clientPortalAccess).set({ revokedAt: new Date() }).where(and(eq(clientPortalAccess.organisationId, input.organisationId), eq(clientPortalAccess.jobId, input.jobId), isNull(clientPortalAccess.revokedAt)));
  const token = randomBytes(32).toString("base64url");
  const [access] = await tx.insert(clientPortalAccess).values({ organisationId: input.organisationId, jobId: input.jobId, email: input.email, tokenHash: hash(token), source: input.source, createdByUserId: input.actorUserId, expiresAt: new Date(Date.now() + portalLifetimeMs), lastSentAt: input.source === "practice_link" ? null : new Date() }).returning();
  return { access, token, url: portalUrl(access.id, token) };
}

async function jobFacts(tx: TenantTransaction, organisationId: string, jobId: string) {
  const [row] = await tx.select({ reference: jobs.reference, clientName: clients.displayName, clientEmail: clients.email, line1: properties.line1, city: properties.city, postcode: properties.postcode, organisationName: organisations.name }).from(jobs)
    .innerJoin(clients, and(eq(clients.id, jobs.clientId), eq(clients.organisationId, jobs.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, jobs.organisationId))).innerJoin(organisations, eq(organisations.id, jobs.organisationId))
    .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, organisationId))).limit(1);
  return row ?? null;
}

/** Emails a fresh portal link to the client (replacing any earlier link). */
export async function sendPortalLink(context: Context, jobId: string, email?: string | null) {
  if (!canManagePortal(context.role)) throw new PortalError(403, "forbidden", "Office or management access is required.");
  const result = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).for("update").limit(1);
    if (!job) throw new PortalError(404, "not_found", "The job could not be found.");
    const facts = await jobFacts(tx, context.organisationId, jobId);
    const recipient = (email ?? facts?.clientEmail ?? "").trim().toLowerCase();
    if (!z.email().safeParse(recipient).success) throw new PortalError(422, "email_required", "Add the client's email address to send their portal link.");
    const issued = await issueAccess(tx, { organisationId: context.organisationId, jobId, email: recipient, source: "practice_sent", actorUserId: context.internalUserId });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_portal.link_sent", resourceType: "job", resourceId: jobId, metadata: { accessId: issued.access.id } }));
    return { issued, facts: facts!, recipient };
  });
  await enqueueEmail({ organisationId: context.organisationId, type: "client_portal_invite", deduplicationKey: `portal-invite:${result.issued.access.id}`, payload: { recipients: [result.recipient], organisationName: result.facts.organisationName, clientName: result.facts.clientName, propertyAddress: [result.facts.line1, result.facts.city, result.facts.postcode].filter(Boolean).join(", "), reference: result.facts.reference, portalUrl: result.issued.url } });
  return { sentTo: result.recipient, accessId: result.issued.access.id };
}

/** A fresh link to copy and share another way. Replaces any earlier link. */
export async function createPortalLink(context: Context, jobId: string) {
  if (!canManagePortal(context.role)) throw new PortalError(403, "forbidden", "Office or management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).for("update").limit(1);
    if (!job) throw new PortalError(404, "not_found", "The job could not be found.");
    const issued = await issueAccess(tx, { organisationId: context.organisationId, jobId, email: null, source: "practice_link", actorUserId: context.internalUserId });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_portal.link_created", resourceType: "job", resourceId: jobId, metadata: { accessId: issued.access.id } }));
    return { url: issued.url, accessId: issued.access.id };
  });
}

export async function revokePortal(context: Context, jobId: string) {
  if (!canManagePortal(context.role)) throw new PortalError(403, "forbidden", "Office or management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const rows = await tx.update(clientPortalAccess).set({ revokedAt: new Date() }).where(and(eq(clientPortalAccess.organisationId, context.organisationId), eq(clientPortalAccess.jobId, jobId), isNull(clientPortalAccess.revokedAt))).returning({ id: clientPortalAccess.id });
    if (!rows.length) throw new PortalError(404, "not_found", "There is no active portal link for this job.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_portal.link_revoked", resourceType: "job", resourceId: jobId, metadata: {} }));
    return { revoked: rows.length };
  });
}

export async function shareFile(context: Context, jobId: string, input: z.infer<typeof shareInput>) {
  if (!canManagePortal(context.role)) throw new PortalError(403, "forbidden", "Office or management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [media] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).innerJoin(surveys, and(eq(surveys.id, mediaAssets.surveyId), eq(surveys.organisationId, mediaAssets.organisationId))).where(and(eq(mediaAssets.id, input.mediaAssetId), eq(mediaAssets.organisationId, context.organisationId), eq(surveys.jobId, jobId), eq(mediaAssets.status, "stored"))).limit(1);
    if (!media) throw new PortalError(404, "media_not_found", "That file is not part of this job's survey.");
    const [row] = await tx.insert(clientPortalFiles).values({ organisationId: context.organisationId, jobId, mediaAssetId: input.mediaAssetId, category: input.category, title: input.title, sharedByUserId: context.internalUserId }).onConflictDoNothing().returning();
    if (!row) throw new PortalError(409, "already_shared", "This file is already shared.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_portal.file_shared", resourceType: "job", resourceId: jobId, metadata: { fileId: row.id, mediaAssetId: input.mediaAssetId, category: input.category } }));
    return { id: row.id, mediaAssetId: row.mediaAssetId, category: row.category, title: row.title, sharedAt: row.sharedAt.toISOString() };
  });
}

export async function unshareFile(context: Context, jobId: string, fileId: string) {
  if (!canManagePortal(context.role)) throw new PortalError(403, "forbidden", "Office or management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.update(clientPortalFiles).set({ revokedAt: new Date() }).where(and(eq(clientPortalFiles.organisationId, context.organisationId), eq(clientPortalFiles.jobId, jobId), eq(clientPortalFiles.id, fileId), isNull(clientPortalFiles.revokedAt))).returning({ id: clientPortalFiles.id });
    if (!row) throw new PortalError(404, "not_found", "This file is not shared.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_portal.file_unshared", resourceType: "job", resourceId: jobId, metadata: { fileId } }));
    return row;
  });
}

/**
 * Called when a website-form quote converts into a job: issues the portal link and queues
 * the invitation in the same transaction, so a rolled-back conversion never sends a link.
 */
export async function inviteAfterQuoteConversion(tx: TenantTransaction, input: { organisationId: string; jobId: string; email: string | null; clientName: string; propertyAddress: string; reference: string }) {
  if (!input.email || !z.email().safeParse(input.email).success) return null;
  const [organisation] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, input.organisationId)).limit(1);
  const issued = await issueAccess(tx, { organisationId: input.organisationId, jobId: input.jobId, email: input.email.toLowerCase(), source: "quote_accepted", actorUserId: null });
  await tx.insert(backgroundJobs).values({ organisationId: input.organisationId, queue: "email", type: "client_portal_invite", deduplicationKey: `portal-invite:${issued.access.id}`, payload: { recipients: [input.email.toLowerCase()], organisationName: organisation?.name ?? "Your surveying practice", clientName: input.clientName, propertyAddress: input.propertyAddress, reference: input.reference, portalUrl: issued.url } });
  return issued.access.id;
}

