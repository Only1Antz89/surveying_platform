import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canMutateOperations } from "@surveynt/domain";
import { auditEvents, clientContacts, clients, createDatabase } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { clients as demoClients } from "@/lib/demo-data";

const patchClient = z.object({
  displayName: z.string().trim().min(2).max(160).optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  archived: z.boolean().optional(),
  version: z.number().int().positive(),
}).refine((value) => Object.keys(value).some((key) => key !== "version"), "At least one change is required.");

export async function GET(request: Request, route: RouteContext<"/api/v1/clients/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo) {
    const client = demoClients.find((item) => item.id === id);
    if (!client) return problem(404, "client_not_found", "The client could not be found.");
    return ok({ client: { id: client.id, kind: client.kind === "Company" ? "company" : "individual", displayName: client.name, email: client.email === "—" ? null : client.email, phone: client.phone === "—" ? null : client.phone, version: client.version ?? 1 }, contacts: [{ id: `contact-${client.id}`, name: client.name, email: client.email === "—" ? null : client.email, phone: client.phone === "—" ? null : client.phone, preferredChannel: "email", primary: true }] }, { demo: true });
  }
  const db = createDatabase();
  const detail = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, id), eq(clients.organisationId, context.organisationId))).limit(1);
    if (!client) return null;
    const contacts = await tx.select().from(clientContacts).where(and(eq(clientContacts.clientId, id), eq(clientContacts.organisationId, context.organisationId)));
    return { client, contacts };
  });
  return detail ? ok(detail) : problem(404, "client_not_found", "The client could not be found.");
}

export async function PATCH(request: Request, route: RouteContext<"/api/v1/clients/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot change client records.");
  const parsed = await parseBody(request, patchClient);
  if (!parsed.success) return problem(400, "invalid_request", "The client changes are invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id, ...parsed.data, version: parsed.data.version + 1 }, { demo: true, persisted: false });
  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [current] = await tx.select().from(clients).where(and(eq(clients.id, id), eq(clients.organisationId, context.organisationId))).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.version !== parsed.data.version) return { kind: "conflict" as const };
    const [updated] = await tx.update(clients).set({
      displayName: parsed.data.displayName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}),
      version: current.version + 1,
      updatedAt: new Date(),
    }).where(and(eq(clients.id, id), eq(clients.organisationId, context.organisationId), eq(clients.version, current.version))).returning();
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: parsed.data.archived ? "client.archived" : "client.updated", resourceType: "client", resourceId: id, metadata: { fromVersion: current.version, toVersion: updated.version } });
    return { kind: "updated" as const, client: updated };
  });
  if (result.kind === "missing") return problem(404, "client_not_found", "The client could not be found.");
  if (result.kind === "conflict") return problem(409, "version_conflict", "The client was changed by another user. Reload before trying again.");
  return ok(result.client);
}
