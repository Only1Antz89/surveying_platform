import "server-only";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, clientContacts, clientMessages, clients, createDatabase, customerQuotes, dataSubjectRequests, engagementAcceptances, invoices, jobRetentionHolds, jobs, properties, websiteEnquiries, withTenant, type TenantTransaction } from "@surveynt/db";
import type { OrganisationRole } from "@surveynt/domain";
import { workspaceAudit } from "./workspace-audit";

// Data protection requests (UK GDPR access and erasure) for people a practice holds data on.
// Erasure anonymises contact details on client records, contacts, quotes and enquiries.
// Survey records, reports, invoices and signed terms are kept where the practice has a
// legal or professional duty to retain them, and the outcome says so.

type Context = { organisationId: string; internalUserId: string | null; role: OrganisationRole; actorRole?: OrganisationRole; workspaceMode?: import("./workspace-mode").WorkspaceMode };
export class PrivacyError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const requestInput = z.object({ subjectEmail: z.email().max(254).transform((value) => value.trim().toLowerCase()), kind: z.enum(["access", "erasure"]), notes: z.string().trim().max(2000).nullable().optional() });
const privacyRoles = new Set<OrganisationRole>(["owner", "administrator"]);
const guard = (context: Context) => { if (!privacyRoles.has(context.role)) throw new PrivacyError(403, "forbidden", "Owner or administrator access is required for data protection requests."); };
const lower = (column: Parameters<typeof sql>[1]) => sql`lower(${column})`;
export const ERASED = "Erased at the person's request";

export type RequestView = { id: string; subjectEmail: string; kind: "access" | "erasure"; status: "open" | "completed" | "refused"; notes: string | null; requestedAt: string; dueAt: string; completedAt: string | null; outcome: Record<string, unknown> | null };
const view = (row: typeof dataSubjectRequests.$inferSelect): RequestView => ({ id: row.id, subjectEmail: row.subjectEmail, kind: row.kind as RequestView["kind"], status: row.status as RequestView["status"], notes: row.notes, requestedAt: row.requestedAt.toISOString(), dueAt: row.dueAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, outcome: row.outcome ?? null });

/** Everything linked to an email address within the practice. */
async function findSubject(tx: TenantTransaction, organisationId: string, email: string) {
  const [clientRows, contactRows, quoteRows, enquiryRows] = await Promise.all([
    tx.select().from(clients).where(and(eq(clients.organisationId, organisationId), eq(lower(clients.email), email))),
    tx.select().from(clientContacts).where(and(eq(clientContacts.organisationId, organisationId), eq(lower(clientContacts.email), email))),
    tx.select().from(customerQuotes).where(and(eq(customerQuotes.organisationId, organisationId), eq(lower(customerQuotes.email), email))),
    tx.select().from(websiteEnquiries).where(and(eq(websiteEnquiries.organisationId, organisationId), eq(lower(websiteEnquiries.email), email))),
  ]);
  const clientIds = [...new Set([...clientRows.map((row) => row.id), ...contactRows.map((row) => row.clientId), ...quoteRows.flatMap((row) => row.clientId ? [row.clientId] : [])])];
  const jobRows = clientIds.length ? await tx.select().from(jobs).where(and(eq(jobs.organisationId, organisationId), inArray(jobs.clientId, clientIds))) : [];
  const jobIds = jobRows.map((row) => row.id);
  const [propertyRows, invoiceRows, messageRows, signatureRows, holdRows] = await Promise.all([
    clientIds.length ? tx.select().from(properties).where(and(eq(properties.organisationId, organisationId), inArray(properties.clientId, clientIds))) : Promise.resolve([]),
    jobIds.length ? tx.select().from(invoices).where(and(eq(invoices.organisationId, organisationId), inArray(invoices.jobId, jobIds))) : Promise.resolve([]),
    jobIds.length ? tx.select().from(clientMessages).where(and(eq(clientMessages.organisationId, organisationId), or(inArray(clientMessages.jobId, jobIds), eq(lower(clientMessages.recipient), email)))) : tx.select().from(clientMessages).where(and(eq(clientMessages.organisationId, organisationId), eq(lower(clientMessages.recipient), email))),
    jobIds.length ? tx.select().from(engagementAcceptances).where(and(eq(engagementAcceptances.organisationId, organisationId), inArray(engagementAcceptances.jobId, jobIds))) : Promise.resolve([]),
    jobIds.length ? tx.select().from(jobRetentionHolds).where(and(eq(jobRetentionHolds.organisationId, organisationId), inArray(jobRetentionHolds.jobId, jobIds), isNotNull(jobRetentionHolds.kind))) : Promise.resolve([]),
  ]);
  return { clientRows, contactRows, quoteRows, enquiryRows, jobRows, propertyRows, invoiceRows, messageRows, signatureRows, holdRows, clientIds };
}

export async function listRequests(context: Context) {
  guard(context);
  return withTenant(createDatabase(), context.organisationId, async (tx) => (await tx.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.organisationId, context.organisationId)).orderBy(desc(dataSubjectRequests.requestedAt)).limit(200)).map(view));
}

/** Records a request with the statutory one-month deadline, and shows what is held. */
export async function openRequest(context: Context, input: z.infer<typeof requestInput>) {
  guard(context);
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const found = await findSubject(tx, context.organisationId, input.subjectEmail);
    const due = new Date(); due.setMonth(due.getMonth() + 1);
    const [row] = await tx.insert(dataSubjectRequests).values({ organisationId: context.organisationId, subjectEmail: input.subjectEmail, kind: input.kind, notes: input.notes ?? null, dueAt: due, createdByUserId: context.internalUserId }).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "privacy.request_opened", resourceType: "data_subject_request", resourceId: row.id, metadata: { kind: input.kind } }));
    return { request: view(row), held: summary(found) };
  });
}

function summary(found: Awaited<ReturnType<typeof findSubject>>) {
  return { clients: found.clientRows.length, contacts: found.contactRows.length, quotes: found.quoteRows.length, enquiries: found.enquiryRows.length, jobs: found.jobRows.length, properties: found.propertyRows.length, invoices: found.invoiceRows.length, messages: found.messageRows.length, signedTerms: found.signatureRows.length, legalHolds: found.holdRows.length };
}

async function openFor(tx: TenantTransaction, organisationId: string, id: string, kind: "access" | "erasure") {
  const [row] = await tx.select().from(dataSubjectRequests).where(and(eq(dataSubjectRequests.organisationId, organisationId), eq(dataSubjectRequests.id, id))).for("update").limit(1);
  if (!row) throw new PrivacyError(404, "not_found", "The request could not be found.");
  if (row.status !== "open") throw new PrivacyError(409, "closed", "This request is already closed.");
  if (row.kind !== kind) throw new PrivacyError(409, "wrong_kind", kind === "access" ? "This is an erasure request." : "This is an access request.");
  return row;
}

/** Builds the subject access export and closes the request. Secrets and internal hashes are never included. */
export async function completeAccessRequest(context: Context, id: string) {
  guard(context);
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const request = await openFor(tx, context.organisationId, id, "access");
    const found = await findSubject(tx, context.organisationId, request.subjectEmail);
    const bundle = {
      subject: request.subjectEmail, generatedAt: new Date().toISOString(),
      note: "Personal data held by the practice about this email address. Professional reports are available on request from the practice.",
      clients: found.clientRows.map(({ id: clientId, displayName, email, phone, kind, createdAt }) => ({ id: clientId, kind, displayName, email, phone, createdAt })),
      contacts: found.contactRows.map(({ name, email, phone, preferredChannel, createdAt }) => ({ name, email, phone, preferredChannel, createdAt })),
      properties: found.propertyRows.map(({ line1, line2, city, postcode, createdAt }) => ({ line1, line2, city, postcode, createdAt })),
      jobs: found.jobRows.map(({ reference, serviceName, stage, targetDate, createdAt }) => ({ reference, serviceName, stage, targetDate, createdAt })),
      quotes: found.quoteRows.map(({ reference, status, firstName, lastName, email, phone, propertyAddress, city, postcode, totalMinor, currency, createdAt }) => ({ reference, status, firstName, lastName, email, phone, propertyAddress, city, postcode, totalMinor, currency, createdAt })),
      enquiries: found.enquiryRows.map(({ reference, firstName, lastName, email, phone, address, createdAt }) => ({ reference, firstName, lastName, email, phone, address, createdAt })),
      invoices: found.invoiceRows.map(({ number, status, totalMinor, currency, issuedAt, paidAt }) => ({ number, status, totalMinor, currency, issuedAt, paidAt })),
      messages: found.messageRows.map(({ templateKey, channel, status, createdAt }) => ({ templateKey, channel, status, createdAt })),
      signedTerms: found.signatureRows.map(({ signerName, signerEmail, signedAt, method }) => ({ signerName, signerEmail, signedAt, method })),
    };
    const counts = summary(found);
    await tx.update(dataSubjectRequests).set({ status: "completed", completedAt: new Date(), completedByUserId: context.internalUserId, outcome: { exported: counts } }).where(eq(dataSubjectRequests.id, id));
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "privacy.access_completed", resourceType: "data_subject_request", resourceId: id, metadata: { counts } }));
    return bundle;
  });
}

/** Erases contact details, refusing while any linked job is under a complaint, claim or legal hold. */
export async function completeErasureRequest(context: Context, id: string) {
  guard(context);
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const request = await openFor(tx, context.organisationId, id, "erasure");
    const found = await findSubject(tx, context.organisationId, request.subjectEmail);
    if (found.holdRows.length) throw new PrivacyError(409, "legal_hold", "A linked job is under a complaint, claim or legal hold. Resolve the hold or refuse the request with a reason.");
    const now = new Date();
    if (found.clientRows.length) await tx.update(clients).set({ displayName: ERASED, email: null, phone: null, archivedAt: now, version: sql`${clients.version} + 1`, updatedAt: now }).where(and(eq(clients.organisationId, context.organisationId), inArray(clients.id, found.clientRows.map((row) => row.id))));
    if (found.contactRows.length) await tx.update(clientContacts).set({ name: ERASED, email: null, phone: null, updatedAt: now }).where(and(eq(clientContacts.organisationId, context.organisationId), inArray(clientContacts.id, found.contactRows.map((row) => row.id))));
    if (found.quoteRows.length) await tx.update(customerQuotes).set({ firstName: null, lastName: null, email: null, phone: null, updatedAt: now }).where(and(eq(customerQuotes.organisationId, context.organisationId), inArray(customerQuotes.id, found.quoteRows.map((row) => row.id))));
    if (found.enquiryRows.length) await tx.update(websiteEnquiries).set({ firstName: "Erased", lastName: "Erased", email: "erased@invalid", phone: null, address: {}, answers: {}, updatedAt: now }).where(and(eq(websiteEnquiries.organisationId, context.organisationId), inArray(websiteEnquiries.id, found.enquiryRows.map((row) => row.id))));
    const outcome = {
      erased: { clients: found.clientRows.length, contacts: found.contactRows.length, quotes: found.quoteRows.length, enquiries: found.enquiryRows.length },
      retained: [
        ...(found.jobRows.length ? [`${found.jobRows.length} survey record(s) and reports: professional records kept for the practice's limitation period`] : []),
        ...(found.invoiceRows.length ? [`${found.invoiceRows.length} invoice(s): accounting records kept for six years`] : []),
        ...(found.signatureRows.length ? [`${found.signatureRows.length} signed terms of engagement: contract evidence`] : []),
        ...(found.propertyRows.length ? [`${found.propertyRows.length} property address(es): linked to retained survey records`] : []),
      ],
    };
    await tx.update(dataSubjectRequests).set({ status: "completed", completedAt: now, completedByUserId: context.internalUserId, outcome }).where(eq(dataSubjectRequests.id, id));
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "privacy.erasure_completed", resourceType: "data_subject_request", resourceId: id, metadata: { erased: outcome.erased, retainedCategories: outcome.retained.length } }));
    return { request: view({ ...request, status: "completed", completedAt: now, outcome }), outcome };
  });
}

export async function refuseRequest(context: Context, id: string, reason: string) {
  guard(context);
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.select().from(dataSubjectRequests).where(and(eq(dataSubjectRequests.organisationId, context.organisationId), eq(dataSubjectRequests.id, id))).for("update").limit(1);
    if (!row) throw new PrivacyError(404, "not_found", "The request could not be found.");
    if (row.status !== "open") throw new PrivacyError(409, "closed", "This request is already closed.");
    const now = new Date();
    await tx.update(dataSubjectRequests).set({ status: "refused", completedAt: now, completedByUserId: context.internalUserId, outcome: { refusedBecause: reason } }).where(eq(dataSubjectRequests.id, id));
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "privacy.request_refused", resourceType: "data_subject_request", resourceId: id, metadata: {} }));
    return view({ ...row, status: "refused", completedAt: now, outcome: { refusedBecause: reason } });
  });
}
