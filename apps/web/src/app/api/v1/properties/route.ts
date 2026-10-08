import {workspaceAudit} from "@/lib/workspace-audit";
import { assignedPropertyScope } from "@/lib/workspace-scope";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { jobs as demoJobs, properties as demoProperties } from "@/lib/demo-data";
import { auditEvents, clients, createDatabase, properties } from "@surveynt/db";
import { canMutateOperations, ukCountries } from "@surveynt/domain";
import { addressSources } from "@surveynt/property-data";
import { and, asc, eq, sql } from "drizzle-orm";

const createProperty = z.object({ clientId: z.uuid(), line1: z.string().trim().min(2).max(180), line2: z.string().trim().max(180).optional(), city: z.string().trim().min(2).max(100), postcode: z.string().trim().min(5).max(10), propertyType: z.string().trim().max(100).optional(), country: z.enum(ukCountries).optional(), addressSource: z.enum(addressSources).optional() });

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok(demoProperties.filter(p=>context.role!=="surveyor"||demoJobs.some(j=>j.assignee==="Maya Patel"&&j.client===p.client)), { demo: true, nextCursor: null });
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select().from(properties).where(and(assignedPropertyScope(context), eq(properties.organisationId, context.organisationId), assignedPropertyScope(context))).orderBy(asc(properties.line1)).limit(50);
  });
  return ok(rows, { nextCursor: null });
}

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, createProperty);
  if (!parsed.success) return problem(400, "invalid_request", "The property details are invalid.", parsed.error.flatten());
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot create property records.");
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, parsed.data.clientId), eq(clients.organisationId, context.organisationId))).limit(1);
    if (!client) return { kind: "client_missing" as const };
    const [created] = await tx.insert(properties).values({ organisationId: context.organisationId, ...parsed.data }).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "property.created", resourceType: "property", resourceId: created.id }));
    return { kind: "created" as const, property: created };
  });
  if (result.kind === "client_missing") return problem(400, "invalid_client", "The selected client does not belong to this workspace.");
  return ok(result.property);
}
