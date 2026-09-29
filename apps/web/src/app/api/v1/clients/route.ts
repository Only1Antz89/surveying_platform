import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { clients as demoClients } from "@/lib/demo-data";
import { clients, createDatabase } from "@fieldnote/db";
import { asc, eq, sql } from "drizzle-orm";

const createClient = z.object({ kind: z.enum(["individual", "company"]), displayName: z.string().trim().min(2).max(160), email: z.email().optional(), phone: z.string().trim().max(40).optional() });

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (context.demo) return ok(demoClients, { demo: true, nextCursor: null });
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select().from(clients).where(eq(clients.organisationId, context.organisationId)).orderBy(asc(clients.displayName)).limit(50);
  });
  return ok(rows, { nextCursor: null });
}

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const parsed = await parseBody(request, createClient);
  if (!parsed.success) return problem(400, "invalid_request", "The client details are invalid.", parsed.error.flatten());
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase();
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.insert(clients).values({ organisationId: context.organisationId, ...parsed.data }).returning();
  });
  return ok(created);
}
