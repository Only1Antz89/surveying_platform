import { servicePricingInput } from "@/lib/service-pricing-input";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditEvents, createDatabase, serviceDefinitions, servicePricingVersions, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const schema = servicePricingInput.and(z.object({ expectedVersion: z.number().int().nonnegative() }));

export async function PATCH(request: Request, route: RouteContext<"/api/v1/service-catalogue/[id]">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing services."); if (!isManagementRole(context.role)) return problem(403, "forbidden", "Only owners and administrators can change pricing.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params; if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "Service not found."); const parsed = await parseBody(request, schema); if (!parsed.success) return problem(400, "invalid_request", "The service pricing is invalid.", parsed.error.flatten()); if (context.demo) return ok({ id, version: parsed.data.expectedVersion + 1, ...parsed.data }, { demo: true, persisted: false });
  const updated = await withTenant(createDatabase(), context.organisationId, async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`service-pricing:${id}`}))`); const [service] = await tx.select().from(serviceDefinitions).where(and(eq(serviceDefinitions.id, id), eq(serviceDefinitions.organisationId, context.organisationId))).limit(1); if (!service) return null; const [latest] = await tx.select().from(servicePricingVersions).where(and(eq(servicePricingVersions.serviceDefinitionId, id), eq(servicePricingVersions.organisationId, context.organisationId))).orderBy(desc(servicePricingVersions.version)).limit(1); if ((latest?.version ?? 0) !== parsed.data.expectedVersion) return { stale: true as const }; await tx.update(servicePricingVersions).set({ active: false, updatedAt: new Date() }).where(and(eq(servicePricingVersions.serviceDefinitionId, id), eq(servicePricingVersions.active, true))); await tx.update(serviceDefinitions).set({ name: parsed.data.name, defaultFee: (parsed.data.baseAmountMinor / 100).toFixed(2), active: parsed.data.active, updatedAt: new Date() }).where(eq(serviceDefinitions.id, id)); const [pricing] = await tx.insert(servicePricingVersions).values({ organisationId: context.organisationId, serviceDefinitionId: id, version: (latest?.version ?? 0) + 1, currency: latest?.currency ?? "GBP", baseAmountMinor: parsed.data.baseAmountMinor, vatBasisPoints: parsed.data.vatBasisPoints, depositBasisPoints: parsed.data.depositBasisPoints, durationMinutes: parsed.data.durationMinutes, validityDays: parsed.data.validityDays, surcharges: parsed.data.surcharges, recommendationRules: parsed.data.recommendationRules, active: parsed.data.active, createdByUserId: context.internalUserId }).returning(); await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "service_pricing.version_created", resourceType: "service_definition", resourceId: id, metadata: { pricingVersionId: pricing.id, version: pricing.version } }); return pricing; });
  if (updated && "stale" in updated) return problem(409,"pricing_changed","The service pricing changed. Reload the catalogue and review the latest version.");
  return updated ? ok(updated) : problem(404, "not_found", "Service not found.");
}

export async function DELETE(request: Request, route: RouteContext<"/api/v1/service-catalogue/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401,"unauthorised","Authentication is required.");
  const denial = await workspaceApiGuard(request,context);
  if (denial) return denial;
  if (!canWriteWorkspace(context)) return problem(402,"workspace_read_only","Restore billing before changing services.");
  if (!isManagementRole(context.role)) return problem(403,"forbidden","Practice management access is required.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404,"not_found","Service not found.");
  const parsed = await parseBody(request,z.object({expectedVersion:z.number().int().nonnegative()}));
  if (!parsed.success) return problem(400,"invalid_request","Review the latest pricing version before archiving.");
  if (context.demo) return ok({archived:true},{demo:true,persisted:false});
  const result = await withTenant(createDatabase(),context.organisationId,async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`service-pricing:${id}`}))`);
    const [service] = await tx.select().from(serviceDefinitions).where(and(eq(serviceDefinitions.id,id),eq(serviceDefinitions.organisationId,context.organisationId))).for("update").limit(1);
    if (!service) return null;
    const [latest] = await tx.select().from(servicePricingVersions).where(and(eq(servicePricingVersions.serviceDefinitionId,id),eq(servicePricingVersions.organisationId,context.organisationId))).orderBy(desc(servicePricingVersions.version)).limit(1);
    if (!service.active && !latest?.active) return { archived:true };
    if ((latest?.version ?? 0) !== parsed.data.expectedVersion) return { stale:true };
    await tx.update(serviceDefinitions).set({active:false,updatedAt:new Date()}).where(eq(serviceDefinitions.id,id));
    await tx.update(servicePricingVersions).set({active:false,updatedAt:new Date()}).where(and(eq(servicePricingVersions.serviceDefinitionId,id),eq(servicePricingVersions.organisationId,context.organisationId)));
    if (latest) await tx.insert(servicePricingVersions).values({...latest,id:undefined,version:latest.version+1,active:false,createdByUserId:context.internalUserId,createdAt:new Date(),updatedAt:new Date()});
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"service.archived",resourceType:"service_definition",resourceId:id,metadata:{version:latest ? latest.version+1 : 0}});
    return {archived:true};
  });
  if (result && "stale" in result) return problem(409,"pricing_changed","Reload and review the latest pricing before archiving.");
  return result ? ok(result) : problem(404,"not_found","Service not found.");
}
