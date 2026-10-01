import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canManageTeam } from "@surveynt/domain";
import { auditEvents, createDatabase, onboardingSteps, organisationBranding, organisations, serviceDefinitions } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(160),
  region: z.string().trim().min(2).max(100),
  tradingName: z.string().trim().min(2).max(160),
  supportEmail: z.union([z.email(), z.literal("")]),
  accentColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  services: z.array(z.object({ id: z.uuid().optional(), name: z.string().trim().min(2).max(160), defaultFee: z.union([z.string().regex(/^\d+(\.\d{1,2})?$/), z.literal("")]) })).max(20),
});

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (context.demo) return ok({ id: context.organisationId, name: "North Star Surveying", slug: "north-star-surveying", status: "active", region: "South West England", branding: { tradingName: "North Star Surveying", supportEmail: "hello@northstarsurveying.co.uk", accentColour: "#3b82f6" }, services: [] }, { demo: true });
  const db = createDatabase();
  const data = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [organisation] = await tx.select().from(organisations).where(eq(organisations.id, context.organisationId)).limit(1);
    const [branding] = await tx.select().from(organisationBranding).where(eq(organisationBranding.organisationId, context.organisationId)).limit(1);
    const services = await tx.select().from(serviceDefinitions).where(and(eq(serviceDefinitions.organisationId, context.organisationId), eq(serviceDefinitions.active, true)));
    return { ...organisation, branding, services };
  });
  return ok(data);
}

export async function PATCH(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace settings.");
  if (!canManageTeam(context.role)) return problem(403, "forbidden", "Only owners and administrators can change practice settings.");
  const parsed = await parseBody(request, settingsSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The practice settings are invalid.", parsed.error.flatten());
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });

  const clerk = await clerkClient();
  await clerk.organizations.updateOrganization(context.clerkOrganisationId, { name: parsed.data.name });
  const db = createDatabase();
  const saved = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    await tx.update(organisations).set({ name: parsed.data.name, region: parsed.data.region, updatedAt: new Date() }).where(eq(organisations.id, context.organisationId));
    await tx.insert(organisationBranding).values({ organisationId: context.organisationId, tradingName: parsed.data.tradingName, supportEmail: parsed.data.supportEmail || null, accentColour: parsed.data.accentColour.toLowerCase() }).onConflictDoUpdate({ target: organisationBranding.organisationId, set: { tradingName: parsed.data.tradingName, supportEmail: parsed.data.supportEmail || null, accentColour: parsed.data.accentColour.toLowerCase(), updatedAt: new Date() } });
    await tx.update(serviceDefinitions).set({ active: false, updatedAt: new Date() }).where(eq(serviceDefinitions.organisationId, context.organisationId));
    const services: Array<typeof serviceDefinitions.$inferSelect> = [];
    for (const service of parsed.data.services) {
      if (service.id) {
        const [updated] = await tx.update(serviceDefinitions).set({ name: service.name, defaultFee: service.defaultFee || null, active: true, updatedAt: new Date() }).where(and(eq(serviceDefinitions.id, service.id), eq(serviceDefinitions.organisationId, context.organisationId))).returning();
        if (updated) { services.push(updated); continue; }
      }
      const [created] = await tx.insert(serviceDefinitions).values({ organisationId: context.organisationId, name: service.name, defaultFee: service.defaultFee || null }).returning();
      services.push(created);
    }
    await tx.insert(onboardingSteps).values({ organisationId: context.organisationId, key: "services", completedAt: services.length ? new Date() : null, completedByUserId: context.internalUserId }).onConflictDoUpdate({ target: [onboardingSteps.organisationId, onboardingSteps.key], set: { completedAt: services.length ? new Date() : null, completedByUserId: services.length ? context.internalUserId : null, updatedAt: new Date() } });
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "organisation.settings_updated", resourceType: "organisation", resourceId: context.organisationId, metadata: { serviceCount: services.length } });
    return { ...parsed.data, services };
  });
  return ok(saved);
}
