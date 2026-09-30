import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { auditEvents, createDatabase, organisations, platformIncidentOrganisations, platformIncidents } from "@fieldnote/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const updateIncident = z.object({
  status: z.enum(["investigating", "monitoring", "resolved"]).optional(),
  summary: z.string().trim().min(10).max(5000).optional(),
  organisationIds: z.array(z.uuid()).max(200).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export async function PATCH(request: Request, route: RouteContext<"/api/platform/incidents/[incidentId]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, updateIncident);
  if (!parsed.success) return problem(400, "invalid_request", "The incident change is invalid.", parsed.error.flatten());
  const { incidentId } = await route.params;
  if (operator.demo) return ok({ id: incidentId, ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(platformIncidents).where(eq(platformIncidents.id, incidentId)).limit(1);
    if (!current) return { kind: "missing" as const };
    if (parsed.data.organisationIds) {
      const distinctIds = [...new Set(parsed.data.organisationIds)];
      const valid = distinctIds.length ? await tx.select({ id: organisations.id }).from(organisations).where(inArray(organisations.id, distinctIds)) : [];
      if (valid.length !== distinctIds.length) return { kind: "invalid_tenants" as const };
      await tx.delete(platformIncidentOrganisations).where(eq(platformIncidentOrganisations.incidentId, incidentId));
      if (distinctIds.length) await tx.insert(platformIncidentOrganisations).values(distinctIds.map((organisationId) => ({ incidentId, organisationId })));
    }
    const resolvedAt = parsed.data.status === "resolved" ? new Date() : parsed.data.status && current.status === "resolved" ? null : undefined;
    const [updated] = await tx.update(platformIncidents).set({ status: parsed.data.status, summary: parsed.data.summary, resolvedAt, updatedAt: new Date() }).where(and(eq(platformIncidents.id, incidentId), eq(platformIncidents.updatedAt, current.updatedAt))).returning();
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: parsed.data.status === "resolved" ? "incident.resolved" : "incident.updated", resourceType: "platform_incident", resourceId: incidentId, metadata: { previousStatus: current.status, fields: Object.keys(parsed.data) } });
    return { kind: "updated" as const, incident: updated };
  });
  if (result.kind === "missing") return problem(404, "incident_not_found", "The incident could not be found.");
  if (result.kind === "invalid_tenants") return problem(400, "invalid_tenants", "One or more affected tenants could not be found.");
  if (result.kind === "conflict") return problem(409, "incident_conflict", "The incident changed while this update was being applied. Reload and try again.");
  return ok(result.incident);
}
