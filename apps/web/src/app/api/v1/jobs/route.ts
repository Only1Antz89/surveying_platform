import { z } from "zod";
import { canMutateOperations, jobStages } from "@fieldnote/domain";
import { auditEvents, clients, createDatabase, jobs, jobStageEvents, organisationMemberships, properties } from "@fieldnote/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { jobs as demoJobs } from "@/lib/demo-data";

const createJob = z.object({ clientId: z.uuid(), propertyId: z.uuid(), reference: z.string().trim().min(3).max(40), serviceName: z.string().trim().min(2).max(160), stage: z.enum(jobStages).default("enquiry"), priority: z.enum(["normal", "high"]).default("normal"), assignedSurveyorId: z.uuid().optional(), targetDate: z.iso.date().optional(), fee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), notes: z.string().max(5000).optional() });

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (context.demo) return ok(demoJobs, { demo: true, nextCursor: null });
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select().from(jobs).where(eq(jobs.organisationId, context.organisationId)).orderBy(desc(jobs.updatedAt)).limit(50);
  });
  return ok(rows, { nextCursor: null });
}

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const parsed = await parseBody(request, createJob);
  if (!parsed.success) return problem(400, "invalid_request", "The job details are invalid.", parsed.error.flatten());
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot create jobs.");
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase();
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
      const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, parsed.data.clientId), eq(clients.organisationId, context.organisationId))).limit(1);
      if (!client) return { kind: "client_missing" as const };
      const [property] = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.id, parsed.data.propertyId), eq(properties.clientId, parsed.data.clientId), eq(properties.organisationId, context.organisationId))).limit(1);
      if (!property) return { kind: "property_missing" as const };
      if (parsed.data.assignedSurveyorId) {
        const [assignee] = await tx.select({ id: organisationMemberships.id }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, parsed.data.assignedSurveyorId), eq(organisationMemberships.active, true))).limit(1);
        if (!assignee) return { kind: "assignee_missing" as const };
      }
      const [created] = await tx.insert(jobs).values({ organisationId: context.organisationId, ...parsed.data }).returning();
      await tx.insert(jobStageEvents).values({ organisationId: context.organisationId, jobId: created.id, toStage: created.stage, changedByUserId: context.internalUserId, reason: "Job created" });
      await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "job.created", resourceType: "job", resourceId: created.id, metadata: { reference: created.reference } });
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
