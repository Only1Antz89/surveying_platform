import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, createDatabase, engagementAcceptances, engagementTerms, jobs, organisationOperationalSettings, withTenant, type TenantTransaction } from "@surveynt/db";
import { workspaceAudit } from "./workspace-audit";
import { assignedJobScope } from "./workspace-scope";
import { readPublicQuote } from "./firm-operations";

// Terms of engagement: practice-written, versioned, published once and then frozen.
// A client signs a specific version by typing their name; the signature records the
// exact text's SHA-256 so the signed wording can always be proven later.

export class EngagementError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
type Context = { organisationId: string; internalUserId: string | null; role: import("@surveynt/domain").OrganisationRole; actorRole?: import("@surveynt/domain").OrganisationRole; workspaceMode?: import("./workspace-mode").WorkspaceMode };

export const termsDraftInput = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(50).max(40000) });
export const signatureInput = z.object({ termsId: z.uuid(), signerName: z.string().trim().min(2).max(120), signerEmail: z.email().max(254).nullable().optional(), agree: z.literal(true) });
export const practiceSignatureInput = z.object({ signerName: z.string().trim().min(2).max(120), signedOn: z.iso.date(), confirm: z.literal(true) });

export const termsDigest = (title: string, body: string) => createHash("sha256").update(`${title}\n\n${body}`).digest("hex");
const hashed = (value: string | null) => value ? createHash("sha256").update(`engagement:${value}`).digest("hex") : null;
const managers = new Set(["owner", "administrator", "manager"]);

export type TermsVersion = { id: string; version: number; title: string; body: string; status: "draft" | "published" | "retired"; publishedAt: string | null; updatedAt: string };
const view = (row: typeof engagementTerms.$inferSelect): TermsVersion => ({ id: row.id, version: row.version, title: row.title, body: row.body, status: row.status as TermsVersion["status"], publishedAt: row.publishedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() });
export type Acceptance = { id: string; termsId: string; version: number; signerName: string; signerEmail: string | null; method: string; signedAt: string; termsSha256: string };

async function settingsRequired(tx: TenantTransaction, organisationId: string) {
  const [row] = await tx.select({ required: organisationOperationalSettings.engagementTermsRequired }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, organisationId)).limit(1);
  return row?.required ?? false;
}
async function publishedTerms(tx: TenantTransaction, organisationId: string) {
  const [row] = await tx.select().from(engagementTerms).where(and(eq(engagementTerms.organisationId, organisationId), eq(engagementTerms.status, "published"))).orderBy(desc(engagementTerms.version)).limit(1);
  return row ?? null;
}
async function acceptanceFor(tx: TenantTransaction, organisationId: string, jobId: string): Promise<Acceptance | null> {
  const [row] = await tx.select({ acceptance: engagementAcceptances, version: engagementTerms.version }).from(engagementAcceptances).innerJoin(engagementTerms, and(eq(engagementTerms.id, engagementAcceptances.termsId), eq(engagementTerms.organisationId, engagementAcceptances.organisationId)))
    .where(and(eq(engagementAcceptances.organisationId, organisationId), eq(engagementAcceptances.jobId, jobId))).orderBy(desc(engagementAcceptances.signedAt)).limit(1);
  return row ? { id: row.acceptance.id, termsId: row.acceptance.termsId, version: row.version, signerName: row.acceptance.signerName, signerEmail: row.acceptance.signerEmail, method: row.acceptance.method, signedAt: row.acceptance.signedAt.toISOString(), termsSha256: row.acceptance.termsSha256 } : null;
}

/** Practice settings: every version plus the requirement flag. */
export async function practiceTerms(context: Context) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const rows = await tx.select().from(engagementTerms).where(eq(engagementTerms.organisationId, context.organisationId)).orderBy(desc(engagementTerms.version));
    return { required: await settingsRequired(tx, context.organisationId), versions: rows.map(view) };
  });
}

export async function saveTermsDraft(context: Context, input: z.infer<typeof termsDraftInput>) {
  if (!managers.has(context.role)) throw new EngagementError(403, "forbidden", "Practice management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organisationId}:engagement-terms`}))`);
    const [draft] = await tx.select().from(engagementTerms).where(and(eq(engagementTerms.organisationId, context.organisationId), eq(engagementTerms.status, "draft"))).limit(1);
    const row = draft
      ? (await tx.update(engagementTerms).set({ title: input.title, body: input.body, updatedAt: new Date() }).where(eq(engagementTerms.id, draft.id)).returning())[0]
      : (await tx.insert(engagementTerms).values({ organisationId: context.organisationId, version: ((await tx.select({ max: sql<number>`coalesce(max(${engagementTerms.version}), 0)::int` }).from(engagementTerms).where(eq(engagementTerms.organisationId, context.organisationId)))[0].max) + 1, title: input.title, body: input.body, createdByUserId: context.internalUserId }).returning())[0];
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "engagement_terms.draft_saved", resourceType: "engagement_terms", resourceId: row.id, metadata: { version: row.version } }));
    return view(row);
  });
}

export async function publishTerms(context: Context, termsId: string) {
  if (!managers.has(context.role)) throw new EngagementError(403, "forbidden", "Practice management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organisationId}:engagement-terms`}))`);
    const [draft] = await tx.select().from(engagementTerms).where(and(eq(engagementTerms.organisationId, context.organisationId), eq(engagementTerms.id, termsId), eq(engagementTerms.status, "draft"))).limit(1);
    if (!draft) throw new EngagementError(409, "not_a_draft", "Only a draft can be published. Reload to see the current versions.");
    await tx.update(engagementTerms).set({ status: "retired", updatedAt: new Date() }).where(and(eq(engagementTerms.organisationId, context.organisationId), eq(engagementTerms.status, "published")));
    const [row] = await tx.update(engagementTerms).set({ status: "published", publishedAt: new Date(), publishedByUserId: context.internalUserId, updatedAt: new Date() }).where(eq(engagementTerms.id, draft.id)).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "engagement_terms.published", resourceType: "engagement_terms", resourceId: row.id, metadata: { version: row.version, sha256: termsDigest(row.title, row.body) } }));
    return view(row);
  });
}

export async function setTermsRequired(context: Context, required: boolean) {
  if (!managers.has(context.role)) throw new EngagementError(403, "forbidden", "Practice management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    if (required && !await publishedTerms(tx, context.organisationId)) throw new EngagementError(409, "terms_not_published", "Publish your terms before requiring a signature.");
    await tx.insert(organisationOperationalSettings).values({ organisationId: context.organisationId, engagementTermsRequired: required }).onConflictDoUpdate({ target: organisationOperationalSettings.organisationId, set: { engagementTermsRequired: required, updatedAt: new Date() } });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "engagement_terms.requirement_changed", resourceType: "organisation", resourceId: context.organisationId, metadata: { required } }));
    return { required };
  });
}

/** Signing status for the job record. */
export async function jobEngagement(context: Context, jobId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!job) return null;
    const [required, terms, acceptance] = await Promise.all([settingsRequired(tx, context.organisationId), publishedTerms(tx, context.organisationId), acceptanceFor(tx, context.organisationId, jobId)]);
    return { required, current: terms ? { id: terms.id, version: terms.version, title: terms.title } : null, acceptance };
  });
}

/** Records terms signed on paper or by another agreed method. */
export async function recordPracticeSignature(context: Context, jobId: string, input: z.infer<typeof practiceSignatureInput>) {
  if (!managers.has(context.role)) throw new EngagementError(403, "forbidden", "Practice management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).for("update").limit(1);
    if (!job) throw new EngagementError(404, "not_found", "The job could not be found.");
    const terms = await publishedTerms(tx, context.organisationId);
    if (!terms) throw new EngagementError(409, "terms_not_published", "Publish your terms of engagement first.");
    const signedAt = new Date(`${input.signedOn}T12:00:00Z`);
    if (signedAt.getTime() > Date.now() + 86_400_000) throw new EngagementError(422, "future_date", "The signing date cannot be in the future.");
    const [row] = await tx.insert(engagementAcceptances).values({ organisationId: context.organisationId, jobId, termsId: terms.id, termsSha256: termsDigest(terms.title, terms.body), signerName: input.signerName, method: "recorded_by_practice", signedAt }).onConflictDoNothing().returning();
    if (!row) throw new EngagementError(409, "already_signed", "These terms are already signed for this job.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "engagement_terms.signature_recorded", resourceType: "job", resourceId: jobId, metadata: { termsId: terms.id, version: terms.version, method: "recorded_by_practice" } }));
    return acceptanceFor(tx, context.organisationId, jobId);
  });
}

async function publicCase(quoteId: string, token: string) {
  const found = await readPublicQuote(quoteId, token);
  if (!found?.row.jobId || found.row.status !== "converted") return null;
  return { organisationId: found.row.organisationId, jobId: found.row.jobId, quoteId: found.row.id };
}
const adminDb = () => createDatabase(process.env.DATABASE_ADMIN_URL);

/** What the client sees: the current terms and any signature for their job. */
export async function publicEngagement(quoteId: string, token: string) {
  const found = await publicCase(quoteId, token);
  if (!found) return null;
  return withTenant(adminDb(), found.organisationId, async (tx) => {
    const [required, terms, acceptance] = await Promise.all([settingsRequired(tx, found.organisationId), publishedTerms(tx, found.organisationId), acceptanceFor(tx, found.organisationId, found.jobId)]);
    return { required, terms: terms ? { id: terms.id, version: terms.version, title: terms.title, body: terms.body } : null, acceptance: acceptance ? { version: acceptance.version, signerName: acceptance.signerName, signedAt: acceptance.signedAt, method: acceptance.method } : null };
  });
}

export async function signPublicEngagement(quoteId: string, token: string, input: z.infer<typeof signatureInput>, client: { ip: string | null; userAgent: string | null }) {
  const found = await publicCase(quoteId, token);
  if (!found) throw new EngagementError(404, "case_not_found", "This case link is unavailable.");
  return withTenant(adminDb(), found.organisationId, async (tx) => {
    await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, found.jobId), eq(jobs.organisationId, found.organisationId))).for("update");
    const terms = await publishedTerms(tx, found.organisationId);
    if (!terms || terms.id !== input.termsId) throw new EngagementError(409, "terms_changed", "The practice has updated its terms. Please read the latest version before signing.");
    const [row] = await tx.insert(engagementAcceptances).values({ organisationId: found.organisationId, jobId: found.jobId, termsId: terms.id, termsSha256: termsDigest(terms.title, terms.body), signerName: input.signerName, signerEmail: input.signerEmail ?? null, method: "typed_signature", ipHash: hashed(client.ip), userAgent: client.userAgent?.slice(0, 300) ?? null }).onConflictDoNothing().returning();
    if (row) await tx.insert(auditEvents).values({ organisationId: found.organisationId, action: "engagement_terms.signed_by_client", resourceType: "job", resourceId: found.jobId, metadata: { termsId: terms.id, version: terms.version, quoteId: found.quoteId } });
    const acceptance = await acceptanceFor(tx, found.organisationId, found.jobId);
    return acceptance ? { version: acceptance.version, signerName: acceptance.signerName, signedAt: acceptance.signedAt, method: acceptance.method } : null;
  });
}

/** Booking gate: when the practice requires terms, the current version must be signed first. */
export async function termsBlockBooking(tx: TenantTransaction, organisationId: string, jobId: string) {
  if (!await settingsRequired(tx, organisationId)) return false;
  const terms = await publishedTerms(tx, organisationId);
  if (!terms) return false;
  const [signed] = await tx.select({ id: engagementAcceptances.id }).from(engagementAcceptances).where(and(eq(engagementAcceptances.organisationId, organisationId), eq(engagementAcceptances.jobId, jobId), eq(engagementAcceptances.termsId, terms.id))).limit(1);
  return !signed;
}
