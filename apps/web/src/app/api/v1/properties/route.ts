import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { properties as demoProperties } from "@/lib/demo-data";
import { createDatabase, properties } from "@fieldnote/db";
import { asc, eq, sql } from "drizzle-orm";

const createProperty = z.object({ clientId: z.uuid(), line1: z.string().trim().min(2).max(180), line2: z.string().trim().max(180).optional(), city: z.string().trim().min(2).max(100), postcode: z.string().trim().min(5).max(10), propertyType: z.string().trim().max(100).optional() });

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (context.demo) return ok(demoProperties, { demo: true, nextCursor: null });
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select().from(properties).where(eq(properties.organisationId, context.organisationId)).orderBy(asc(properties.line1)).limit(50);
  });
  return ok(rows, { nextCursor: null });
}

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const parsed = await parseBody(request, createProperty);
  if (!parsed.success) return problem(400, "invalid_request", "The property details are invalid.", parsed.error.flatten());
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase();
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.insert(properties).values({ organisationId: context.organisationId, ...parsed.data }).returning();
  });
  return ok(created);
}
