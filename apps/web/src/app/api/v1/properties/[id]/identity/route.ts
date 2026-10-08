import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { canConfirmPropertyIdentity, canMutateOperations, ukCountries } from "@surveynt/domain";
import { createDatabase, properties, propertyIdentityEvents, users, withTenant } from "@surveynt/db";
import { addressFingerprint, uprnEvidenceTypes } from "@surveynt/property-data";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { identityView, updatePropertyIdentity } from "@/lib/property-identity";

export const runtime = "nodejs";

const version = z.number().int().positive();
const identityAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_location"), version, lookupId: z.uuid(), index: z.number().int().min(0).max(9), replaceConfirmed: z.boolean().optional() }),
  z.object({ action: z.literal("confirm_uprn"), version, uprn: z.string().trim().regex(/^[0-9]{1,12}$/), evidenceType: z.enum(uprnEvidenceTypes), note: z.string().trim().max(500).nullable().optional(), fromCandidates: z.boolean().optional(), useUprnPoint: z.boolean().optional() }),
  z.object({ action: z.literal("clear_uprn"), version, reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("clear_location"), version, reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("set_country"), version, country: z.enum(ukCountries).nullable() }),
]);

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/identity">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo) return ok({ identity: null, events: [] }, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "property_not_found", "The property could not be found.");
  const db = createDatabase();
  const detail = await withTenant(db, context.organisationId, async (tx) => {
    const [property] = await tx.select().from(properties).where(and(eq(properties.id, id), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!property) return null;
    const events = await tx.select({ event: propertyIdentityEvents, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(propertyIdentityEvents).leftJoin(users, eq(propertyIdentityEvents.actorUserId, users.id)).where(and(eq(propertyIdentityEvents.propertyId, id), eq(propertyIdentityEvents.organisationId, context.organisationId))).orderBy(desc(propertyIdentityEvents.createdAt)).limit(50);
    return { property, events };
  });
  if (!detail) return problem(404, "property_not_found", "The property could not be found.");
  return ok({
    identity: identityView(detail.property, await addressFingerprint(detail.property)),
    version: detail.property.version,
    events: detail.events.map(({ event, firstName, lastName, email }) => ({ id: event.id, action: event.action, previous: event.previous, next: event.next, evidence: event.evidence, createdAt: event.createdAt.toISOString(), actor: [firstName, lastName].filter(Boolean).join(" ") || email || "System" })),
  });
}

export async function PUT(request: Request, route: RouteContext<"/api/v1/properties/[id]/identity">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot change property records.");
  const parsed = await parseBody(request, identityAction);
  if (!parsed.success) return problem(400, "invalid_request", "The identity change is invalid.", parsed.error.flatten());
  if ((parsed.data.action === "confirm_uprn" || parsed.data.action === "clear_uprn") && !canConfirmPropertyIdentity(context.role, context.canRecordSurvey)) return problem(403, "forbidden", "Only owners, administrators and surveyors can confirm or clear a UPRN.");
  const { id } = await route.params;
  if (context.demo) return ok({ id, action: parsed.data.action, version: parsed.data.version + 1 }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "property_not_found", "The property could not be found.");
  const result = await updatePropertyIdentity({ organisationId: context.organisationId, internalUserId: context.internalUserId, demo: false }, id, parsed.data);
  if (result.kind === "missing") return problem(404, "property_not_found", "The property could not be found.");
  if (result.kind === "conflict") return problem(409, "version_conflict", "The property was changed by another user. Reload before trying again.");
  if (result.kind === "invalid") return problem(422, "identity_rejected", result.message);
  return ok({ identity: identityView(result.property, await addressFingerprint(result.property)), version: result.property.version, warnings: result.warnings });
}
