import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, createDatabase, jobs, referralSources, withTenant } from "@surveynt/db";
import { canMutateOperations, isManagementRole, type OrganisationRole } from "@surveynt/domain";
import { workspaceAudit } from "./workspace-audit";
import { assignedJobScope } from "./workspace-scope";
import { feeToMinor } from "./job-costs-model";

type Context = { organisationId: string; internalUserId: string | null; role: OrganisationRole; actorRole?: OrganisationRole; workspaceMode?: import("./workspace-mode").WorkspaceMode };
export class ReferralError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const referralKinds = ["estate_agent", "mortgage_broker", "lender", "solicitor", "website", "repeat_client", "other"] as const;
export const referralKindLabels: Record<(typeof referralKinds)[number], string> = { estate_agent: "Estate agent", mortgage_broker: "Mortgage broker", lender: "Lender", solicitor: "Solicitor or conveyancer", website: "Website or search", repeat_client: "Repeat client", other: "Other" };
export const referralInput = z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(referralKinds), email: z.email().max(254).nullable().optional() });
export type ReferralSource = { id: string; name: string; kind: (typeof referralKinds)[number]; email: string | null; active: boolean };

const view = (row: typeof referralSources.$inferSelect): ReferralSource => ({ id: row.id, name: row.name, kind: row.kind as ReferralSource["kind"], email: row.email, active: row.active });

export async function listReferralSources(context: Context) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => (await tx.select().from(referralSources).where(eq(referralSources.organisationId, context.organisationId)).orderBy(asc(referralSources.name))).map(view));
}

export async function createReferralSource(context: Context, input: z.infer<typeof referralInput>) {
  if (!isManagementRole(context.role)) throw new ReferralError(403, "forbidden", "Practice management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.insert(referralSources).values({ organisationId: context.organisationId, name: input.name, kind: input.kind, email: input.email ?? null }).onConflictDoNothing().returning();
    if (!row) throw new ReferralError(409, "duplicate", "A referral source with this name already exists.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "referral_source.created", resourceType: "referral_source", resourceId: row.id, metadata: { kind: row.kind } }));
    return view(row);
  });
}

export async function setReferralSourceActive(context: Context, id: string, active: boolean) {
  if (!isManagementRole(context.role)) throw new ReferralError(403, "forbidden", "Practice management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.update(referralSources).set({ active, updatedAt: new Date() }).where(and(eq(referralSources.organisationId, context.organisationId), eq(referralSources.id, id))).returning();
    if (!row) throw new ReferralError(404, "not_found", "The referral source could not be found.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: active ? "referral_source.reactivated" : "referral_source.archived", resourceType: "referral_source", resourceId: id, metadata: {} }));
    return view(row);
  });
}

export async function jobReferral(context: Context, jobId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ referralSourceId: jobs.referralSourceId }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!job) return null;
    const sources = (await tx.select().from(referralSources).where(eq(referralSources.organisationId, context.organisationId)).orderBy(asc(referralSources.name))).map(view);
    return { referralSourceId: job.referralSourceId, sources: sources.filter((source) => source.active || source.id === job.referralSourceId) };
  });
}

export async function setJobReferral(context: Context, jobId: string, referralSourceId: string | null) {
  if (!canMutateOperations(context.role) || context.role === "surveyor") throw new ReferralError(403, "forbidden", "Office or management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    if (referralSourceId) {
      const [source] = await tx.select({ id: referralSources.id }).from(referralSources).where(and(eq(referralSources.organisationId, context.organisationId), eq(referralSources.id, referralSourceId), eq(referralSources.active, true))).limit(1);
      if (!source) throw new ReferralError(422, "invalid_source", "Choose an active referral source.");
    }
    const [row] = await tx.update(jobs).set({ referralSourceId, updatedAt: new Date() }).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).returning({ id: jobs.id });
    if (!row) throw new ReferralError(404, "not_found", "The job could not be found.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "job.referral_source_set", resourceType: "job", resourceId: jobId, metadata: { referralSourceId } }));
    return { referralSourceId };
  });
}

/** Instructions and fees by referral source over the last 12 months. */
export async function referralReport(context: Context, now = new Date()) {
  if (!isManagementRole(context.role)) throw new ReferralError(403, "forbidden", "Practice management access is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const since = new Date(now.getTime() - 365 * 86_400_000);
    const rows = await tx.select({ sourceId: jobs.referralSourceId, fee: jobs.fee, stage: jobs.stage }).from(jobs).where(and(eq(jobs.organisationId, context.organisationId), gte(jobs.createdAt, since)));
    const sources = (await tx.select().from(referralSources).where(eq(referralSources.organisationId, context.organisationId))).map(view);
    const bySource = new Map<string | null, { jobs: number; feesMinor: number; issued: number }>();
    for (const row of rows) {
      const entry = bySource.get(row.sourceId) ?? { jobs: 0, feesMinor: 0, issued: 0 };
      entry.jobs++; entry.feesMinor += feeToMinor(row.fee) ?? 0; if (["issued", "paid", "archived"].includes(row.stage)) entry.issued++;
      bySource.set(row.sourceId, entry);
    }
    const report = sources.map((source) => ({ source, ...(bySource.get(source.id) ?? { jobs: 0, feesMinor: 0, issued: 0 }) })).sort((a, b) => b.jobs - a.jobs || a.source.name.localeCompare(b.source.name));
    return { report, untracked: bySource.get(null) ?? { jobs: 0, feesMinor: 0, issued: 0 }, total: rows.length, since: since.toISOString() };
  });
}
