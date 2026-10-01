import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canMutateOperations } from "@surveynt/domain";
import { auditEvents, clients, createDatabase, jobs, properties } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { jobs as demoJobs, properties as demoProperties } from "@/lib/demo-data";

const patchProperty = z.object({
  line1: z.string().trim().min(2).max(180).optional(),
  line2: z.string().trim().max(180).nullable().optional(),
  city: z.string().trim().min(2).max(100).optional(),
  postcode: z.string().trim().min(5).max(10).optional(),
  propertyType: z.string().trim().max(100).nullable().optional(),
  archived: z.boolean().optional(),
  version: z.number().int().positive(),
}).refine((value) => Object.keys(value).some((key) => key !== "version"), "At least one change is required.");

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) {
    const property = demoProperties.find((item) => item.id === id);
    return property ? ok({
      property: { id: property.id, line1: property.address, line2: null, city: property.town, postcode: property.postcode, propertyType: property.type, version: property.version ?? 1 },
      clientName: property.client,
      jobs: demoJobs.filter((job) => job.address.includes(property.address)).map((job) => ({ id: job.id, reference: job.reference, serviceName: job.service, stage: job.stage, targetDate: null })),
    }, { demo: true }) : problem(404, "property_not_found", "The property could not be found.");
  }
  const db = createDatabase();
  const detail = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [property] = await tx.select({ property: properties, clientName: clients.displayName }).from(properties).innerJoin(clients, eq(properties.clientId, clients.id)).where(and(eq(properties.id, id), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!property) return null;
    const linkedJobs = await tx.select({ id: jobs.id, reference: jobs.reference, serviceName: jobs.serviceName, stage: jobs.stage, targetDate: jobs.targetDate }).from(jobs).where(and(eq(jobs.propertyId, id), eq(jobs.organisationId, context.organisationId)));
    return { ...property, jobs: linkedJobs };
  });
  return detail ? ok(detail) : problem(404, "property_not_found", "The property could not be found.");
}

export async function PATCH(request: Request, route: RouteContext<"/api/v1/properties/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot change property records.");
  const parsed = await parseBody(request, patchProperty);
  if (!parsed.success) return problem(400, "invalid_request", "The property changes are invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id, ...parsed.data, version: parsed.data.version + 1 }, { demo: true, persisted: false });
  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [current] = await tx.select().from(properties).where(and(eq(properties.id, id), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.version !== parsed.data.version) return { kind: "conflict" as const };
    const identityChanged = (parsed.data.line1 !== undefined && parsed.data.line1 !== current.line1)
      || (parsed.data.line2 !== undefined && parsed.data.line2 !== current.line2)
      || (parsed.data.city !== undefined && parsed.data.city !== current.city)
      || (parsed.data.postcode !== undefined && parsed.data.postcode !== current.postcode);
    const [updated] = await tx.update(properties).set({
      line1: parsed.data.line1,
      line2: parsed.data.line2,
      city: parsed.data.city,
      postcode: parsed.data.postcode,
      propertyType: parsed.data.propertyType,
      ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}),
      ...(identityChanged ? { country: null, uprn: null, latitude: null, longitude: null, addressSource: null, locationConfidence: "unresolved" as const, locationResolutionMethod: null, resolvedAt: null, confirmedByUserId: null } : {}),
      version: current.version + 1,
      updatedAt: new Date(),
    }).where(and(eq(properties.id, id), eq(properties.organisationId, context.organisationId), eq(properties.version, current.version))).returning();
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: parsed.data.archived ? "property.archived" : "property.updated", resourceType: "property", resourceId: id, metadata: { fromVersion: current.version, toVersion: updated.version, identityCleared: identityChanged } });
    return { kind: "updated" as const, property: updated };
  });
  if (result.kind === "missing") return problem(404, "property_not_found", "The property could not be found.");
  if (result.kind === "conflict") return problem(409, "version_conflict", "The property was changed by another user. Reload before trying again.");
  return ok(result.property);
}
