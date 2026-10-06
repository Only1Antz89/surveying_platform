import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, createDatabase, properties } from "@surveynt/db";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const identitySchema = z.object({
  version: z.number().int().positive(),
  country: z.literal("ENG"),
  uprn: z.string().regex(/^\d{1,12}$/).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressSource: z.enum(["manual", "postcodes_io", "nominatim", "os_open_uprn"]),
  resolutionMethod: z.enum(["manual_coordinates", "postcode_centroid", "geocoder_selection", "uprn_candidate_confirmed"]),
  evidence: z.object({ providerKey: z.string().max(50), sourceRecordId: z.string().max(100), label: z.string().max(500), distanceMetres: z.number().nonnegative().max(1000).optional() }),
});

export async function POST(request: Request, route: RouteContext<"/api/v1/properties/[id]/identity/confirm">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const professionalDenial = professionalApiGuard(request, context);
  if (professionalDenial) return professionalDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot confirm property identity.");
  const parsed = await parseBody(request, identitySchema);
  if (!parsed.success) return problem(400, "invalid_identity", "The property identity is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id, ...parsed.data, version: parsed.data.version + 1 }, { demo: true, persisted: false });
  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [current] = await tx.select().from(properties).where(and(eq(properties.id, id), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.version !== parsed.data.version) return { kind: "conflict" as const };
    const [updated] = await tx.update(properties).set({
      country: parsed.data.country,
      uprn: parsed.data.uprn,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      addressSource: parsed.data.addressSource,
      locationConfidence: parsed.data.uprn ? "confirmed" : "approximate",
      locationResolutionMethod: parsed.data.resolutionMethod,
      resolvedAt: new Date(),
      confirmedByUserId: context.internalUserId,
      version: current.version + 1,
      updatedAt: new Date(),
    }).where(and(eq(properties.id, id), eq(properties.organisationId, context.organisationId), eq(properties.version, current.version))).returning();
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "property.identity_confirmed", resourceType: "property", resourceId: id, metadata: { ...parsed.data.evidence, uprn: parsed.data.uprn, resolutionMethod: parsed.data.resolutionMethod, fromVersion: current.version, toVersion: updated.version } });
    return { kind: "updated" as const, property: updated };
  });
  if (result.kind === "missing") return problem(404, "property_not_found", "The property could not be found.");
  if (result.kind === "conflict") return problem(409, "version_conflict", "The property changed while identity was being confirmed. Reload and review it again.");
  return ok(result.property);
}
