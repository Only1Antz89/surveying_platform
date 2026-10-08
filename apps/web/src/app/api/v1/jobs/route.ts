import {workspaceAudit} from "@/lib/workspace-audit";
import { assignedJobScope, scopedDemoJobs } from "@/lib/workspace-scope";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { canMutateOperations, jobStages } from "@surveynt/domain";
import { auditEvents, clients, createDatabase, jobAssignments, jobs, jobStageEvents, organisationMemberships, properties } from "@surveynt/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { jobs as demoJobs } from "@/lib/demo-data";

const createJob = z.object({ clientId: z.string().min(1), propertyId: z.string().min(1), reference: z.string().trim().min(3).max(40), serviceName: z.string().trim().min(2).max(160), stage: z.enum(jobStages).default("enquiry"), priority: z.enum(["normal", "high"]).default("normal"), assignedSurveyorId: z.string().min(1).optional(), coordinatorId: z.string().min(1).optional(), targetDate: z.iso.date().optional(), fee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), notes: z.string().max(5000).optional() });

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok(scopedDemoJobs(demoJobs,context.role), { demo: true, nextCursor: null });
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select().from(jobs).where(and(assignedJobScope(context), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).orderBy(desc(jobs.updatedAt)).limit(50);
  });
  return ok(context.role === "surveyor" ? rows.map(({ fee, ...job }) => { void fee; return job; }) : rows, { nextCursor: null });
}

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, createJob);
  if (!parsed.success) return problem(400, "invalid_request", "The job details are invalid.", parsed.error.flatten());
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot create jobs.");
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data, version: 1 }, { demo: true, persisted: false });
  const db = createDatabase();
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
      const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, parsed.data.clientId), eq(clients.organisationId, context.organisationId))).limit(1);
      if (!client) return { kind: "client_missing" as const };
      const [property] = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.id, parsed.data.propertyId), eq(properties.clientId, parsed.data.clientId), eq(properties.organisationId, context.organisationId))).limit(1);
      if (!property) return { kind: "property_missing" as const };
      for (const memberId of [parsed.data.assignedSurveyorId, parsed.data.coordinatorId].filter((value): value is string => Boolean(value))) {
        const [member] = await tx.select({ id: organisationMemberships.id }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, memberId), eq(organisationMemberships.active, true))).limit(1);
        if (!member) return { kind: "assignee_missing" as const };
      }
      const { coordinatorId, ...jobValues } = parsed.data;
      const [created] = await tx.insert(jobs).values({ organisationId: context.organisationId, ...jobValues }).returning();
      if (coordinatorId) await tx.insert(jobAssignments).values({ organisationId: context.organisationId, jobId: created.id, userId: coordinatorId, responsibility: "coordinator" });
      await tx.insert(jobStageEvents).values({ organisationId: context.organisationId, jobId: created.id, toStage: created.stage, changedByUserId: context.internalUserId, reason: "Job created" });
      await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "job.created", resourceType: "job", resourceId: created.id, metadata: { reference: created.reference } }));
      return { kind: "created" as const, job: created };
    });
    if (result.kind === "client_missing") return problem(400, "invalid_client", "The selected client does not belong to this workspace.");
    if (result.kind === "property_missing") return problem(400, "invalid_property", "The selected property is not linked to that client in this workspace.");
    if (result.kind === "assignee_missing") return problem(400, "invalid_assignee", "The selected surveyor is not an active workspace member.");
    return ok(result.job);
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return problem(409, "reference_exists", "That job reference is already in use.");
    throw error;
  }
}
