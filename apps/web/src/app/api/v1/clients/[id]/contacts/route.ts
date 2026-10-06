import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canMutateOperations } from "@surveynt/domain";
import { auditEvents, clientContacts, clients, createDatabase } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const contactInput = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  preferredChannel: z.enum(["email", "phone", "sms", "post"]).default("email"),
  primary: z.boolean().default(false),
});

export async function POST(request: Request, route: RouteContext<"/api/v1/clients/[id]/contacts">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot change client contacts.");
  const parsed = await parseBody(request, contactInput);
  if (!parsed.success) return problem(400, "invalid_request", "The contact details are invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id: crypto.randomUUID(), clientId: id, ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, id), eq(clients.organisationId, context.organisationId))).limit(1);
    if (!client) return null;
    if (parsed.data.primary) await tx.update(clientContacts).set({ primary: false }).where(and(eq(clientContacts.clientId, id), eq(clientContacts.organisationId, context.organisationId)));
    const [created] = await tx.insert(clientContacts).values({ organisationId: context.organisationId, clientId: id, ...parsed.data }).returning();
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_contact.created", resourceType: "client_contact", resourceId: created.id, metadata: { clientId: id, primary: created.primary } });
    return created;
  });
  return result ? ok(result) : problem(404, "client_not_found", "The client could not be found.");
}
