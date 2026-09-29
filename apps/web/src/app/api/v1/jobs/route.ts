import { z } from "zod";
import { jobStages } from "@fieldnote/domain";
import { createDatabase, jobs } from "@fieldnote/db";
import { desc, eq, sql } from "drizzle-orm";
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
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase();
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.insert(jobs).values({ organisationId: context.organisationId, ...parsed.data }).returning();
  });
  return ok(created);
}
