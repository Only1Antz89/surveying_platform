import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, createDatabase, jobCostEntries, jobs, organisationOperationalSettings, users, withTenant, type TenantTransaction } from "@surveynt/db";
import { isManagementRole, type OrganisationRole } from "@surveynt/domain";
import { workspaceAudit } from "./workspace-audit";
import { assignedJobScope } from "./workspace-scope";
import { costSummary, feeToMinor, type CostEntry, type CostEntryInput, type CostRates } from "./job-costs-model";

type Context = { organisationId: string; internalUserId: string | null; role: OrganisationRole; actorRole?: OrganisationRole; workspaceMode?: import("./workspace-mode").WorkspaceMode };
export class JobCostError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const recorders = new Set<OrganisationRole>(["owner", "administrator", "manager", "surveyor", "coordinator"]);
const canSeeMoney = (role: OrganisationRole) => isManagementRole(role) || role === "finance";

async function rates(tx: TenantTransaction, organisationId: string): Promise<CostRates> {
  const [row] = await tx.select({ staffCostRatePence: organisationOperationalSettings.staffCostRatePence, mileageRatePence: organisationOperationalSettings.mileageRatePence }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, organisationId)).limit(1);
  return row ?? { staffCostRatePence: 3500, mileageRatePence: 45 };
}
const toEntry = (row: typeof jobCostEntries.$inferSelect & { firstName: string | null; lastName: string | null }): CostEntry => ({ id: row.id, kind: row.kind as CostEntry["kind"], occurredOn: row.occurredOn, minutes: row.minutes, miles: row.miles == null ? null : Number(row.miles), amountMinor: row.amountMinor, category: row.category, description: row.description, userId: row.userId, userName: [row.firstName, row.lastName].filter(Boolean).join(" ") || null, createdAt: row.createdAt.toISOString() });

/** Entries and totals for a job. Fee, profit and other people's entries are shown only to management and finance. */
export async function jobCosts(context: Context, jobId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id, fee: jobs.fee }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!job) return null;
    const money = canSeeMoney(context.role);
    const rows = await tx.select({ entry: jobCostEntries, firstName: users.firstName, lastName: users.lastName }).from(jobCostEntries).leftJoin(users, eq(users.id, jobCostEntries.userId))
      .where(and(eq(jobCostEntries.organisationId, context.organisationId), eq(jobCostEntries.jobId, jobId), money ? undefined : eq(jobCostEntries.userId, context.internalUserId ?? "00000000-0000-0000-0000-000000000000"))).orderBy(desc(jobCostEntries.occurredOn), desc(jobCostEntries.createdAt)).limit(500);
    const entries = rows.map((row) => toEntry({ ...row.entry, firstName: row.firstName, lastName: row.lastName }));
    const practiceRates = await rates(tx, context.organisationId);
    const summary = costSummary(entries, practiceRates, money ? feeToMinor(job.fee) : null);
    return { entries, summary: money ? summary : { ...summary, timeCostMinor: 0, mileageCostMinor: 0, totalCostMinor: summary.expensesMinor }, showsMoney: money, rates: money ? practiceRates : null };
  });
}

export async function addCostEntry(context: Context, jobId: string, input: CostEntryInput) {
  if (!recorders.has(context.role) || !context.internalUserId) throw new JobCostError(403, "forbidden", "Your role cannot record time or expenses.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!job) throw new JobCostError(404, "not_found", "The job could not be found.");
    const [row] = await tx.insert(jobCostEntries).values({ organisationId: context.organisationId, jobId, userId: context.internalUserId!, kind: input.kind, occurredOn: input.occurredOn, minutes: input.kind === "time" ? input.minutes : null, miles: input.kind === "mileage" ? input.miles.toFixed(1) : null, amountMinor: input.kind === "expense" ? input.amountMinor : null, category: input.kind === "expense" ? input.category : null, description: input.description || null }).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "job.cost_recorded", resourceType: "job", resourceId: jobId, metadata: { entryId: row.id, kind: row.kind } }));
    return toEntry({ ...row, firstName: null, lastName: null });
  });
}

/** People remove their own entries; management can remove any. */
export async function removeCostEntry(context: Context, jobId: string, entryId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.delete(jobCostEntries).where(and(eq(jobCostEntries.organisationId, context.organisationId), eq(jobCostEntries.jobId, jobId), eq(jobCostEntries.id, entryId), isManagementRole(context.role) ? undefined : eq(jobCostEntries.userId, context.internalUserId ?? "00000000-0000-0000-0000-000000000000"))).returning({ id: jobCostEntries.id, kind: jobCostEntries.kind });
    if (!row) throw new JobCostError(404, "not_found", "The entry could not be found or is not yours to remove.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "job.cost_removed", resourceType: "job", resourceId: jobId, metadata: { entryId, kind: row.kind } }));
    return row;
  });
}

export type ProfitRow = { jobId: string; reference: string; serviceName: string; stage: string; feeMinor: number | null; costMinor: number; profitMinor: number | null; marginPercent: number | null; minutes: number };
/** Profitability for jobs with recent cost activity or recent updates, plus per-service totals. Management and finance only. */
export async function practiceProfitability(context: Context, days = 90) {
  if (!canSeeMoney(context.role)) throw new JobCostError(403, "forbidden", "Profitability is available to management and finance.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const since = new Date(Date.now() - days * 86_400_000);
    const recent = await tx.select({ id: jobs.id, reference: jobs.reference, serviceName: jobs.serviceName, stage: jobs.stage, fee: jobs.fee }).from(jobs)
      .where(and(eq(jobs.organisationId, context.organisationId), sql`(${jobs.updatedAt} >= ${since} or exists (select 1 from job_cost_entries e where e.organisation_id = ${jobs.organisationId} and e.job_id = ${jobs.id} and e.created_at >= ${since}))`)).orderBy(desc(jobs.updatedAt)).limit(300);
    const entries = recent.length ? await tx.select({ jobId: jobCostEntries.jobId, kind: jobCostEntries.kind, minutes: jobCostEntries.minutes, miles: jobCostEntries.miles, amountMinor: jobCostEntries.amountMinor }).from(jobCostEntries).where(and(eq(jobCostEntries.organisationId, context.organisationId), inArray(jobCostEntries.jobId, recent.map((job) => job.id)))) : [];
    const practiceRates = await rates(tx, context.organisationId);
    const rows: ProfitRow[] = recent.map((job) => {
      const summary = costSummary(entries.filter((entry) => entry.jobId === job.id).map((entry) => ({ kind: entry.kind as CostEntry["kind"], minutes: entry.minutes, miles: entry.miles == null ? null : Number(entry.miles), amountMinor: entry.amountMinor })), practiceRates, feeToMinor(job.fee));
      return { jobId: job.id, reference: job.reference, serviceName: job.serviceName, stage: job.stage, feeMinor: summary.feeMinor, costMinor: summary.totalCostMinor, profitMinor: summary.profitMinor, marginPercent: summary.marginPercent, minutes: summary.minutes };
    });
    const services = [...new Set(rows.map((row) => row.serviceName))].map((service) => {
      const list = rows.filter((row) => row.serviceName === service && row.feeMinor != null && row.costMinor > 0);
      const fee = list.reduce((sum, row) => sum + row.feeMinor!, 0), cost = list.reduce((sum, row) => sum + row.costMinor, 0);
      return { service, jobs: list.length, feeMinor: fee, costMinor: cost, marginPercent: fee ? Math.round((fee - cost) / fee * 1000) / 10 : null, averageMinutes: list.length ? Math.round(list.reduce((sum, row) => sum + row.minutes, 0) / list.length) : 0 };
    }).filter((service) => service.jobs > 0).sort((a, b) => b.feeMinor - a.feeMinor);
    return { rows: rows.filter((row) => row.costMinor > 0), services, rates: practiceRates, days };
  });
}
