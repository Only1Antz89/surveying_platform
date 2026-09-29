import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canMutateOperations, canTransitionJob, jobStages } from "@fieldnote/domain";
import { auditEvents, createDatabase, jobs, jobStageEvents, organisationMemberships } from "@fieldnote/db";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { jobs as demoJobs } from "@/lib/demo-data";

const patchJob = z.object({ stage: z.enum(jobStages).optional(), assigneeId: z.uuid().nullable().optional(), targetDate: z.iso.date().nullable().optional(), priority: z.enum(["normal", "high"]).optional(), notes: z.string().max(5000).nullable().optional(), version: z.number().int().positive() }).refine((value) => Object.keys(value).some((key) => key !== "version"), "At least one change is required.");

export async function GET(request: Request, context: RouteContext<"/api/v1/jobs/[id]">) {
  const session = await apiContext(request);
  if (!session) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await context.params;
  if (session.demo) {
    const job = demoJobs.find((item) => item.id === id);
    return job ? ok(job, { demo: true }) : problem(404, "job_not_found", "The job could not be found.");
  }
  const db = createDatabase();
  const [job] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${session.organisationId}, true)`);
    return tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.organisationId, session.organisationId))).limit(1);
  });
  return job ? ok(job) : problem(404, "job_not_found", "The job could not be found.");
}

export async function PATCH(request: Request, context: RouteContext<"/api/v1/jobs/[id]">) {
  const session = await apiContext(request);
  if (!session) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canMutateOperations(session.role)) return problem(403, "forbidden", "Your role cannot change jobs.");
  const parsed = await parseBody(request, patchJob);
  if (!parsed.success) return problem(400, "invalid_request", "The requested job changes are invalid.", parsed.error.flatten());
  const { id } = await context.params;
  if (session.demo) return ok({ id, ...parsed.data, version: parsed.data.version + 1 }, { demo: true, persisted: false });
  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${session.organisationId}, true)`);
    const [current] = await tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.organisationId, session.organisationId))).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.version !== parsed.data.version) return { kind: "conflict" as const };
    if (parsed.data.stage && !canTransitionJob(current.stage, parsed.data.stage)) return { kind: "transition" as const, from: current.stage, to: parsed.data.stage };
    if (parsed.data.assigneeId) {
      const [assignee] = await tx.select({ id: organisationMemberships.id }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, session.organisationId), eq(organisationMemberships.userId, parsed.data.assigneeId), eq(organisationMemberships.active, true))).limit(1);
      if (!assignee) return { kind: "assignee_missing" as const };
    }
    const changes = { stage: parsed.data.stage, targetDate: parsed.data.targetDate, priority: parsed.data.priority, notes: parsed.data.notes };
    const [updated] = await tx.update(jobs).set({ ...changes, ...(parsed.data.assigneeId !== undefined ? { assignedSurveyorId: parsed.data.assigneeId } : {}), version: current.version + 1, updatedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.organisationId, session.organisationId), eq(jobs.version, current.version))).returning();
    if (!updated) return { kind: "conflict" as const };
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
