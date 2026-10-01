import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { canMutateOperations, canTransitionJob, jobStages } from "@surveynt/domain";
import { auditEvents, createDatabase, jobAssignments, jobs, jobStageEvents, organisationMemberships, users } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { jobs as demoJobs, members as demoMembers } from "@/lib/demo-data";

const patchJob = z.object({
  stage: z.enum(jobStages).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  coordinatorId: z.string().min(1).nullable().optional(),
  serviceName: z.string().trim().min(2).max(160).optional(),
  targetDate: z.iso.date().nullable().optional(),
  priority: z.enum(["normal", "high"]).optional(),
  fee: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  version: z.number().int().positive(),
}).refine((value) => Object.keys(value).some((key) => key !== "version"), "At least one change is required.");

export async function GET(request: Request, context: RouteContext<"/api/v1/jobs/[id]">) {
  const session = await apiContext(request);
  if (!session) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await context.params;
  if (session.demo) {
    const job = demoJobs.find((item) => item.id === id);
    if (!job) return problem(404, "job_not_found", "The job could not be found.");
    const assignee = demoMembers.find((member) => member.name === job.assignee);
    return ok({ job: { ...job, serviceName: job.service, assignedSurveyorId: assignee?.id ?? null, coordinatorId: null, targetDate: null, notes: null, version: job.version ?? 1 }, stageHistory: [{ id: "demo-created", fromStage: null, toStage: job.stage, reason: "Job created", changedBy: "Demo user", createdAt: new Date().toISOString() }] }, { demo: true });
  }
  const db = createDatabase();
  const detail = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${session.organisationId}, true)`);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.organisationId, session.organisationId))).limit(1);
    if (!job) return null;
    const events = await tx.select({ event: jobStageEvents, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(jobStageEvents).leftJoin(users, eq(jobStageEvents.changedByUserId, users.id)).where(and(eq(jobStageEvents.jobId, id), eq(jobStageEvents.organisationId, session.organisationId))).orderBy(asc(jobStageEvents.createdAt));
    const [coordinator] = await tx.select({ userId: jobAssignments.userId }).from(jobAssignments).where(and(eq(jobAssignments.jobId, id), eq(jobAssignments.organisationId, session.organisationId), eq(jobAssignments.responsibility, "coordinator"))).limit(1);
    return {
      job: { ...job, coordinatorId: coordinator?.userId ?? null },
      stageHistory: events.map(({ event, firstName, lastName, email }) => ({ ...event, changedBy: [firstName, lastName].filter(Boolean).join(" ") || email || "System" })),
    };
  });
  return detail ? ok(detail) : problem(404, "job_not_found", "The job could not be found.");
}

export async function PATCH(request: Request, context: RouteContext<"/api/v1/jobs/[id]">) {
  const session = await apiContext(request);
  if (!session) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(session)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(session.role)) return problem(403, "forbidden", "Your role cannot change jobs.");
  const parsed = await parseBody(request, patchJob);
  if (!parsed.success) return problem(400, "invalid_request", "The requested job changes are invalid.", parsed.error.flatten());
  const { id } = await context.params;
  if (session.demo) {
    const job = demoJobs.find((item) => item.id === id);
    if (!job) return problem(404, "job_not_found", "The job could not be found.");
    const currentAssignee = demoMembers.find((member) => member.name === job.assignee)?.id ?? null;
    return ok({ id, clientId: "demo-client", propertyId: "demo-property", reference: job.reference, serviceName: parsed.data.serviceName ?? job.service, stage: parsed.data.stage ?? job.stage, assignedSurveyorId: parsed.data.assigneeId === undefined ? currentAssignee : parsed.data.assigneeId, coordinatorId: parsed.data.coordinatorId ?? null, targetDate: parsed.data.targetDate ?? null, fee: parsed.data.fee ?? String(job.fee), notes: parsed.data.notes ?? null, priority: parsed.data.priority ?? job.priority.toLowerCase(), version: parsed.data.version + 1 }, { demo: true, persisted: false });
  }
  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${session.organisationId}, true)`);
    const [current] = await tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.organisationId, session.organisationId))).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.version !== parsed.data.version) return { kind: "conflict" as const };
    if (parsed.data.stage && !canTransitionJob(current.stage, parsed.data.stage)) return { kind: "transition" as const, from: current.stage, to: parsed.data.stage };
    const selectedMemberIds = [parsed.data.assigneeId, parsed.data.coordinatorId].filter((value): value is string => Boolean(value));
    for (const memberId of selectedMemberIds) {
      const [member] = await tx.select({ id: organisationMemberships.id }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, session.organisationId), eq(organisationMemberships.userId, memberId), eq(organisationMemberships.active, true))).limit(1);
      if (!member) return { kind: "assignee_missing" as const };
    }
    const changes = { stage: parsed.data.stage, serviceName: parsed.data.serviceName, targetDate: parsed.data.targetDate, priority: parsed.data.priority, fee: parsed.data.fee, notes: parsed.data.notes };
    const [updated] = await tx.update(jobs).set({ ...changes, ...(parsed.data.assigneeId !== undefined ? { assignedSurveyorId: parsed.data.assigneeId } : {}), version: current.version + 1, updatedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.organisationId, session.organisationId), eq(jobs.version, current.version))).returning();
    if (!updated) return { kind: "conflict" as const };
    if (parsed.data.coordinatorId !== undefined) {
      await tx.delete(jobAssignments).where(and(eq(jobAssignments.jobId, id), eq(jobAssignments.organisationId, session.organisationId), eq(jobAssignments.responsibility, "coordinator")));
      if (parsed.data.coordinatorId) await tx.insert(jobAssignments).values({ organisationId: session.organisationId, jobId: id, userId: parsed.data.coordinatorId, responsibility: "coordinator" });
    }
    if (parsed.data.stage) await tx.insert(jobStageEvents).values({ organisationId: session.organisationId, jobId: id, fromStage: current.stage, toStage: parsed.data.stage, changedByUserId: session.internalUserId, reason: "API stage update" });
    await tx.insert(auditEvents).values({ organisationId: session.organisationId, actorUserId: session.internalUserId, action: "job.updated", resourceType: "job", resourceId: id, metadata: { fromVersion: current.version, toVersion: current.version + 1, fields: Object.keys(parsed.data).filter((key) => key !== "version") } });
    return { kind: "updated" as const, job: updated };
  });
  if (result.kind === "missing") return problem(404, "job_not_found", "The job could not be found.");
  if (result.kind === "conflict") return problem(409, "version_conflict", "The job was changed by another user. Reload it before trying again.");
  if (result.kind === "transition") return problem(422, "invalid_stage_transition", `A job cannot move directly from ${result.from} to ${result.to}.`);
  if (result.kind === "assignee_missing") return problem(400, "invalid_assignee", "The selected surveyor is not an active workspace member.");
  return ok(result.job);
}
