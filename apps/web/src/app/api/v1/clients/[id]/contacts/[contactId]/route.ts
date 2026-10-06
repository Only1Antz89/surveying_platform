import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canMutateOperations } from "@surveynt/domain";
import { auditEvents, clientContacts, createDatabase } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const contactPatch = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  preferredChannel: z.enum(["email", "phone", "sms", "post"]).optional(),
  primary: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required.");

async function access(request: Request) {
  const context = await apiContext(request);
  if (!context) return { problem: problem(401, "unauthorised", "Authentication and an active organisation are required.") } as const;
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return { problem: accessDenial } as const;
  if (!canWriteWorkspace(context)) return { problem: problem(402, "workspace_read_only", "Restore billing before changing workspace records.") } as const;
  if (!canMutateOperations(context.role)) return { problem: problem(403, "forbidden", "Your role cannot change client contacts.") } as const;
  return { context } as const;
}

export async function PATCH(request: Request, route: RouteContext<"/api/v1/clients/[id]/contacts/[contactId]">) {
  const authorised = await access(request);
  if ("problem" in authorised) return authorised.problem;
  const parsed = await parseBody(request, contactPatch);
  if (!parsed.success) return problem(400, "invalid_request", "The contact changes are invalid.", parsed.error.flatten());
  const { id, contactId } = await route.params;
  if (authorised.context.demo) return ok({ id: contactId, clientId: id, ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase();
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${authorised.context.organisationId}, true)`);
    const [current] = await tx.select().from(clientContacts).where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId))).limit(1);
    if (!current) return null;
    if (parsed.data.primary) await tx.update(clientContacts).set({ primary: false }).where(and(eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId)));
    const [result] = await tx.update(clientContacts).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId))).returning();
    await tx.insert(auditEvents).values({ organisationId: authorised.context.organisationId, actorUserId: authorised.context.internalUserId, action: "client_contact.updated", resourceType: "client_contact", resourceId: contactId, metadata: { clientId: id, fields: Object.keys(parsed.data) } });
    return result;
  });
  return updated ? ok(updated) : problem(404, "contact_not_found", "The client contact could not be found.");
}

export async function DELETE(request: Request, route: RouteContext<"/api/v1/clients/[id]/contacts/[contactId]">) {
  const authorised = await access(request);
  if ("problem" in authorised) return authorised.problem;
  const { id, contactId } = await route.params;
  if (authorised.context.demo) return ok({ id: contactId, deleted: true }, { demo: true, persisted: false });
  const db = createDatabase();
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${authorised.context.organisationId}, true)`);
    const [result] = await tx.delete(clientContacts).where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId))).returning({ id: clientContacts.id });
    if (!result) return null;
    await tx.insert(auditEvents).values({ organisationId: authorised.context.organisationId, actorUserId: authorised.context.internalUserId, action: "client_contact.deleted", resourceType: "client_contact", resourceId: contactId, metadata: { clientId: id } });
    return result;
  });
  return deleted ? ok({ id: deleted.id, deleted: true }) : problem(404, "contact_not_found", "The client contact could not be found.");
}
