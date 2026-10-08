import { clientApiContext, clientAuditActor, clientDatabase, type ClientApiContext } from "@/lib/client-api-context";
import { demoStore, recordDemoAudit } from "@/lib/demo-store";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canMutateOperations } from "@surveynt/domain";
import { auditEvents, clientContacts, clients } from "@surveynt/db";
import { canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const contactPatch = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  preferredChannel: z.enum(["email", "phone", "sms", "post"]).optional(),
  primary: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required.");

async function access(request: Request): Promise<{ problem: ReturnType<typeof problem> } | { context: ClientApiContext }> {
  const context = await clientApiContext(request);
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
  if (authorised.context.demo) return demoStore.mutate(state => {
    const clientId = `${authorised.context.organisationId}:${id}`;
    const contact = state.contacts.find(item => item.id === contactId && item.clientId === clientId);
    if (!contact) return problem(404, "contact_not_found", "The client contact could not be found.");
    if (parsed.data.primary) state.contacts.filter(item => item.clientId === clientId).forEach(item => { item.primary = false; });
    Object.assign(contact, parsed.data);
    recordDemoAudit(state, authorised.context.organisationId, "client_contact.updated", "client_contact", contactId);
    return ok({ ...contact, clientId: id }, { demo: true, persisted: true });
  });
  const db = clientDatabase(authorised.context);
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${authorised.context.organisationId}, true)`);
    await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, id), eq(clients.organisationId, authorised.context.organisationId))).for("update").limit(1);
    const [current] = await tx.select().from(clientContacts).where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId))).limit(1);
    if (!current) return null;
    if (parsed.data.primary) await tx.update(clientContacts).set({ primary: false }).where(and(eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId)));
    const [result] = await tx.update(clientContacts).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId))).returning();
    await tx.insert(auditEvents).values({ organisationId: authorised.context.organisationId, ...clientAuditActor(authorised.context), action: "client_contact.updated", resourceType: "client_contact", resourceId: contactId, metadata: { clientId: id, fields: Object.keys(parsed.data) } });
    return result;
  });
  return updated ? ok(updated) : problem(404, "contact_not_found", "The client contact could not be found.");
}

export async function DELETE(request: Request, route: RouteContext<"/api/v1/clients/[id]/contacts/[contactId]">) {
  const authorised = await access(request);
  if ("problem" in authorised) return authorised.problem;
  const { id, contactId } = await route.params;
  if (authorised.context.demo) return demoStore.mutate(state => {
    const index = state.contacts.findIndex(item => item.id === contactId && item.clientId === `${authorised.context.organisationId}:${id}`);
    if (index < 0) return problem(404, "contact_not_found", "The client contact could not be found.");
    state.contacts.splice(index, 1);
    recordDemoAudit(state, authorised.context.organisationId, "client_contact.deleted", "client_contact", contactId);
    return ok({ id: contactId, deleted: true }, { demo: true, persisted: true });
  });
  const db = clientDatabase(authorised.context);
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${authorised.context.organisationId}, true)`);
    const [result] = await tx.delete(clientContacts).where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, id), eq(clientContacts.organisationId, authorised.context.organisationId))).returning({ id: clientContacts.id });
    if (!result) return null;
    await tx.insert(auditEvents).values({ organisationId: authorised.context.organisationId, ...clientAuditActor(authorised.context), action: "client_contact.deleted", resourceType: "client_contact", resourceId: contactId, metadata: { clientId: id } });
    return result;
  });
  return deleted ? ok({ id: deleted.id, deleted: true }) : problem(404, "contact_not_found", "The client contact could not be found.");
}
