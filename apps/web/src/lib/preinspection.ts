import "server-only";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { auditEvents, createDatabase, customerQuotes, jobs, organisationMemberships, organisationOperationalSettings, organisations, preinspectionDrafts, preinspectionLinks, preinspectionSubmissions, withTenant, type TenantTransaction } from "@surveynt/db";
import { canonicalJson, preinspectionMutationSchema } from "@surveynt/assistant";
import { isManagementRole, type OrganisationRole } from "@surveynt/domain";
import { readPublicQuote } from "./firm-operations";

export class PreinspectionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export type Scope = { organisationId: string; jobId: string; propertyId: string; actorUserId: string | null; source: "customer" | "staff_transcribed_client"; valuation: boolean };
export type PreinspectionStaff = { organisationId: string; internalUserId: string | null; role: OrganisationRole };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const denied = () => new PreinspectionError(404, "questionnaire_unavailable", "This questionnaire is unavailable or your link has expired.");

async function enabled(tx: TenantTransaction, organisationId: string) {
  const [row] = await tx.select({ enabled: organisationOperationalSettings.surveyEvidenceEnabled, demo: organisations.isDemo, status: organisations.status }).from(organisations).innerJoin(organisationOperationalSettings, eq(organisationOperationalSettings.organisationId, organisations.id)).where(eq(organisations.id, organisationId)).for("share").limit(1);
  // First release is private demo-only. No environment switch silently activates live customer collection.
  if (!row?.enabled || !row.demo || row.status !== "active") throw new PreinspectionError(503, "questionnaire_setup_required", "Whole-form evidence is not enabled for this practice's demo.");
}

export async function publicPreinspection<T>(quoteId: string, parentToken: string, scopedToken: string | null, work: (tx: TenantTransaction, scope: Scope) => Promise<T>) {
  if (!parentToken || parentToken.length > 200 || !z.uuid().safeParse(quoteId).success) throw denied();
  if (!process.env.DATABASE_ADMIN_URL) throw new PreinspectionError(503, "questionnaire_unavailable", "Customer storage is not configured.");
  const found = await readPublicQuote(quoteId, parentToken);
  if (!found?.row.jobId || found.row.status !== "converted" || !process.env.DATABASE_ADMIN_URL) throw denied();
  return withTenant(createDatabase(process.env.DATABASE_ADMIN_URL), found.row.organisationId, async tx => {
    await enabled(tx, found.row.organisationId);
    const [quote] = await tx.select().from(customerQuotes).where(and(eq(customerQuotes.id, quoteId), eq(customerQuotes.organisationId, found.row.organisationId))).for("share").limit(1);
    if (!quote || quote.tokenRevokedAt || quote.accessTokenHash !== hash(parentToken) || quote.status !== "converted" || !quote.jobId) throw denied();
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, quote.jobId), eq(jobs.organisationId, quote.organisationId))).for("update").limit(1);
    if (!job || job.stage === "archived" || job.propertyId !== quote.propertyId) throw denied();
    if (scopedToken !== null) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(scopedToken)) throw denied();
      const [link] = await tx.select().from(preinspectionLinks).where(and(eq(preinspectionLinks.organisationId, quote.organisationId), eq(preinspectionLinks.quoteId, quote.id), eq(preinspectionLinks.jobId, job.id), eq(preinspectionLinks.tokenHash, hash(scopedToken)), isNull(preinspectionLinks.revokedAt))).for("share").limit(1);
      if (!link || link.purpose !== "preinspection" || link.expiresAt <= new Date()) throw denied();
    }
    return work(tx, { organisationId: quote.organisationId, jobId: job.id, propertyId: job.propertyId, actorUserId: null, source: "customer", valuation: /valuation/i.test(job.serviceName) });
  });
}

export async function staffPreinspection<T>(context: PreinspectionStaff, jobId: string, work: (tx: TenantTransaction, scope: Scope) => Promise<T>) {
  if (!z.uuid().safeParse(jobId).success) throw denied();
  return withTenant(createDatabase(), context.organisationId, async tx => {
    const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, context.internalUserId ?? "00000000-0000-0000-0000-000000000000"), eq(organisationMemberships.active, true))).for("share").limit(1);
    if (!member || member.role !== context.role || (!isManagementRole(member.role) && member.role !== "surveyor")) throw denied();
    await enabled(tx, context.organisationId);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).for("update").limit(1);
    if (!job || (member.role === "surveyor" && job.assignedSurveyorId !== context.internalUserId)) throw denied();
    return work(tx, { organisationId: context.organisationId, jobId, propertyId: job.propertyId, actorUserId: context.internalUserId, source: "staff_transcribed_client", valuation: /valuation/i.test(job.serviceName) });
  });
}

export async function readPreinspection(tx: TenantTransaction, scope: Scope) {
  const condition = and(eq(preinspectionDrafts.organisationId, scope.organisationId), eq(preinspectionDrafts.jobId, scope.jobId));
  const [draft] = await tx.select().from(preinspectionDrafts).where(condition).limit(1);
  const submissions = await tx.select({ id: preinspectionSubmissions.id, version: preinspectionSubmissions.version, answers: preinspectionSubmissions.answers, source: preinspectionSubmissions.source, createdAt: preinspectionSubmissions.createdAt }).from(preinspectionSubmissions).where(and(eq(preinspectionSubmissions.organisationId, scope.organisationId), eq(preinspectionSubmissions.jobId, scope.jobId))).orderBy(desc(preinspectionSubmissions.version)).limit(20);
  const [quote] = !draft && !submissions.length ? await tx.select({ answers: customerQuotes.answers }).from(customerQuotes).where(and(eq(customerQuotes.organisationId, scope.organisationId), eq(customerQuotes.jobId, scope.jobId))).limit(1) : [];
  const collected = quote?.answers.websiteFormVersionId ? { ...(typeof quote.answers.reportedPropertyType === "string" ? { propertyType: quote.answers.reportedPropertyType } : {}), ...(typeof quote.answers.concerns === "string" ? { concerns: quote.answers.concerns } : {}), ...(Array.isArray(quote.answers.alterationTypes) && quote.answers.alterationTypes.length ? { alterations: quote.answers.alterationTypes.filter(v => typeof v === "string").join(", ") } : {}) } : {};
  // Statements removed under the retention policy are reported as removed, never shown as empty answers.
  const removed = (answers: Record<string, unknown> | undefined) => answers?.retentionRemoved === true && Object.keys(answers).length === 1;
  const history = submissions.map(row => removed(row.answers) ? { ...row, answers: {}, contentRemoved: true } : { ...row, contentRemoved: false });
  const contentRemoved = removed(draft?.answers) || (!draft && removed(submissions[0]?.answers));
  return { draft: { version: draft?.version ?? 0, answers: contentRemoved ? {} : draft?.answers ?? submissions[0]?.answers ?? collected }, submission: history[0] ?? null, history, contentRemoved, valuation: scope.valuation, label: "Customer statements — not survey findings", demo: true };
}

export async function issuePreinspectionLink(tx: TenantTransaction, scope: Scope, quoteId: string) {
  const now = new Date();
  // Scope callers hold the job lock, so the limit also covers concurrent requests.
  const recent = await tx.select({ id: preinspectionLinks.id }).from(preinspectionLinks).where(and(eq(preinspectionLinks.organisationId, scope.organisationId), eq(preinspectionLinks.jobId, scope.jobId), gte(preinspectionLinks.createdAt, new Date(now.getTime() - 60_000)))).limit(10);
  if (recent.length >= 10) throw new PreinspectionError(429, "questionnaire_link_rate_limited", "Too many questionnaire links were requested. Wait a minute before trying again.");
  const expiresAt = new Date(now.getTime() + 7 * 86_400_000);
  // One active purpose link per customer journey prevents unlimited token proliferation.
  await tx.update(preinspectionLinks).set({ revokedAt: now }).where(and(eq(preinspectionLinks.organisationId, scope.organisationId), eq(preinspectionLinks.jobId, scope.jobId), eq(preinspectionLinks.quoteId, quoteId), isNull(preinspectionLinks.revokedAt)));
  const token = randomBytes(32).toString("base64url");
  const [link] = await tx.insert(preinspectionLinks).values({ organisationId: scope.organisationId, jobId: scope.jobId, quoteId, tokenHash: hash(token), expiresAt }).returning({ id: preinspectionLinks.id });
  await tx.insert(auditEvents).values({ organisationId: scope.organisationId, action: "questionnaire.link_issued", resourceType: "preinspection_link", resourceId: link.id, metadata: { jobId: scope.jobId, expiresAt: expiresAt.toISOString() } });
  return { token, expiresAt, purpose: "preinspection" };
}

export async function writePreinspection(tx: TenantTransaction, scope: Scope, input: unknown, submit: boolean) {
  const parsed = preinspectionMutationSchema.safeParse(input);
  if (!parsed.success) throw new PreinspectionError(400, "invalid_questionnaire", "Check the questionnaire answers and version.");
  if (!scope.valuation && parsed.data.answers.agreedPurchasePriceMinor !== undefined) throw new PreinspectionError(400, "valuation_only", "Purchase price is collected for valuation work only.");
  const { answers, version, requestId } = parsed.data;
  if (submit) {
    const [existing] = await tx.select().from(preinspectionSubmissions).where(and(eq(preinspectionSubmissions.organisationId, scope.organisationId), eq(preinspectionSubmissions.jobId, scope.jobId), eq(preinspectionSubmissions.requestId, requestId))).limit(1);
    if (existing) {
      if (canonicalJson(existing.answers) !== canonicalJson(answers) || existing.source !== scope.source) throw new PreinspectionError(409, "submission_conflict", "This submission identifier has already been used for different answers.");
      return readPreinspection(tx, scope);
    }
  }
  const [draft] = await tx.select().from(preinspectionDrafts).where(and(eq(preinspectionDrafts.organisationId, scope.organisationId), eq(preinspectionDrafts.jobId, scope.jobId))).limit(1);
  if (draft && draft.propertyId !== scope.propertyId) throw new PreinspectionError(409, "property_changed", "The job's property changed. Review the questionnaire association before saving.");
  if ((draft?.version ?? 0) !== version) throw new PreinspectionError(409, "questionnaire_changed", "These answers changed in another session. Reload before saving.");
  const nextVersion = version + 1;
  if (draft) await tx.update(preinspectionDrafts).set({ answers, version: nextVersion, updatedAt: new Date() }).where(eq(preinspectionDrafts.id, draft.id));
  else await tx.insert(preinspectionDrafts).values({ organisationId: scope.organisationId, jobId: scope.jobId, propertyId: scope.propertyId, answers, version: nextVersion });
  if (submit) await tx.insert(preinspectionSubmissions).values({ organisationId: scope.organisationId, jobId: scope.jobId, propertyId: scope.propertyId, version: nextVersion, requestId, answers, source: scope.source, actorUserId: scope.actorUserId });
  await tx.insert(auditEvents).values({ organisationId: scope.organisationId, actorUserId: scope.actorUserId, action: submit ? "questionnaire.submitted" : "questionnaire.draft_saved", resourceType: "job", resourceId: scope.jobId, metadata: { version: nextVersion, source: scope.source } });
  return readPreinspection(tx, scope);
}

export async function revokePreinspectionLinks(tx: TenantTransaction, scope: Scope) {
  await tx.update(preinspectionLinks).set({ revokedAt: new Date() }).where(and(eq(preinspectionLinks.organisationId, scope.organisationId), eq(preinspectionLinks.jobId, scope.jobId), isNull(preinspectionLinks.revokedAt)));
  await tx.insert(auditEvents).values({ organisationId: scope.organisationId, actorUserId: scope.actorUserId, action: "questionnaire.links_revoked", resourceType: "job", resourceId: scope.jobId });
  return { revoked: true };
}
