import { servicePricingInput } from "@/lib/service-pricing-input";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, createDatabase, serviceDefinitions, servicePricingVersions, withTenant } from "@surveynt/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const schema = servicePricingInput;

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok([] as unknown[], { demo: true });
  const data = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ service: serviceDefinitions, pricing: servicePricingVersions }).from(serviceDefinitions).leftJoin(servicePricingVersions, and(eq(servicePricingVersions.serviceDefinitionId, serviceDefinitions.id), eq(servicePricingVersions.version, sql`(select max(v.version) from service_pricing_versions v where v.service_definition_id=${serviceDefinitions.id} and v.organisation_id=${context.organisationId})`))).where(eq(serviceDefinitions.organisationId, context.organisationId)).orderBy(serviceDefinitions.name, desc(servicePricingVersions.version)));
  return ok(data);
}

export async function POST(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing services.");
  if (!isManagementRole(context.role)) return problem(403, "forbidden", "Only owners and administrators can change pricing.");
  const parsed = await parseBody(request, schema); if (!parsed.success) return problem(400, "invalid_request", "The service pricing is invalid.", parsed.error.flatten());
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data }, { demo: true, persisted: false });
  const created = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [service] = await tx.insert(serviceDefinitions).values({ organisationId: context.organisationId, name: parsed.data.name, defaultFee: (parsed.data.baseAmountMinor / 100).toFixed(2), active: parsed.data.active }).returning();
    const [pricing] = await tx.insert(servicePricingVersions).values({ organisationId: context.organisationId, serviceDefinitionId: service.id, version: 1, baseAmountMinor: parsed.data.baseAmountMinor, vatBasisPoints: parsed.data.vatBasisPoints, depositBasisPoints: parsed.data.depositBasisPoints, durationMinutes: parsed.data.durationMinutes, validityDays: parsed.data.validityDays, surcharges: parsed.data.surcharges, recommendationRules: parsed.data.recommendationRules, active: parsed.data.active, createdByUserId: context.internalUserId }).returning();
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "service_pricing.created", resourceType: "service_definition", resourceId: service.id, metadata: { pricingVersionId: pricing.id } });
    return { service, pricing };
  });
  return ok(created);
}
