import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auditEvents, calendarConflicts, createDatabase, withTenant } from "@surveynt/db";
import { canManageTeam } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

export async function POST(request: Request, route: RouteContext<"/api/v1/calendar/conflicts/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to review conflicts.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context) || !canManageTeam(context.role)) return problem(403, "forbidden", "Only owners and administrators can resolve calendar conflicts.");
  const parsed = await parseBody(request, z.object({ decision: z.literal("keep_surveynt") }));
  if (!parsed.success) return problem(400, "invalid_request", "Reschedule in the calendar, or explicitly keep the Surveynt appointment.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(400, "invalid_id", "Choose a conflict.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [conflict] = await tx.select().from(calendarConflicts).where(and(eq(calendarConflicts.id, id), eq(calendarConflicts.organisationId, context.organisationId))).for("update");
    if (!conflict) return problem(404, "not_found", "Conflict not found.");
    if (conflict.status !== "open") return problem(409, "already_resolved", "This conflict has already been reviewed.");
    await tx.update(calendarConflicts).set({ status: "resolved", resolvedAt: new Date(), resolvedByUserId: context.internalUserId, updatedAt: new Date() }).where(eq(calendarConflicts.id, id));
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "calendar.conflict_resolved", resourceType: "calendar_conflict", resourceId: id, metadata: { decision: parsed.data.decision } });
    return ok({ resolved: true, externalCalendarChanged: false });
  });
}
