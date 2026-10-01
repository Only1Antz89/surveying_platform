import { z } from "zod";
import { inArray } from "drizzle-orm";
import { auditEvents, createDatabase, organisations, platformIncidentOrganisations, platformIncidents } from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const createIncident = z.object({
  title: z.string().trim().min(3).max(180),
  summary: z.string().trim().min(10).max(5000),
  severity: z.enum(["low", "medium", "high", "critical"]),
  startedAt: z.iso.datetime(),
  organisationIds: z.array(z.uuid()).max(200).default([]),
});

export async function POST(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, createIncident);
  if (!parsed.success) return problem(400, "invalid_request", "The incident details are invalid.", parsed.error.flatten());
  if (operator.demo) return ok({ id: crypto.randomUUID(), ...parsed.data, status: "investigating" }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const created = await db.transaction(async (tx) => {
    if (parsed.data.organisationIds.length) {
      const valid = await tx.select({ id: organisations.id }).from(organisations).where(inArray(organisations.id, parsed.data.organisationIds));
      if (valid.length !== new Set(parsed.data.organisationIds).size) return null;
    }
    const [incident] = await tx.insert(platformIncidents).values({ title: parsed.data.title, summary: parsed.data.summary, severity: parsed.data.severity, startedAt: new Date(parsed.data.startedAt), createdByStaffId: operator.platformStaffId }).returning();
    if (parsed.data.organisationIds.length) await tx.insert(platformIncidentOrganisations).values([...new Set(parsed.data.organisationIds)].map((organisationId) => ({ incidentId: incident.id, organisationId })));
    await tx.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: "incident.created", resourceType: "platform_incident", resourceId: incident.id, metadata: { severity: incident.severity, affectedOrganisationIds: parsed.data.organisationIds } });
    return incident;
  });
  return created ? ok(created) : problem(400, "invalid_tenants", "One or more affected tenants could not be found.");
}
