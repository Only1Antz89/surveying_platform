import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { canApproveSupportAccess } from "@surveynt/domain";
import { auditEvents, createDatabase, supportSessions } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const decisionSchema = z.object({ decision: z.enum(["approve", "deny"]) });

export async function PATCH(request: Request, route: RouteContext<"/api/v1/support-sessions/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canApproveSupportAccess(context.role)) return problem(403, "forbidden", "Only a practice owner can approve support write access.");
  const parsed = await parseBody(request, decisionSchema);
  if (!parsed.success) return problem(400, "invalid_request", "Choose whether to approve or deny this support request.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id, decision: parsed.data.decision }, { demo: true, persisted: false });
  if (!context.internalUserId) return problem(403, "forbidden", "The owner account could not be resolved.");

  const db = createDatabase();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const now = new Date();
    const pending = and(
      eq(supportSessions.id, id),
      eq(supportSessions.organisationId, context.organisationId),
      eq(supportSessions.permission, "write"),
      eq(supportSessions.breakGlass, false),
      isNull(supportSessions.approvedByUserId),
      isNull(supportSessions.revokedAt),
      gt(supportSessions.expiresAt, now),
    );
    const [session] = await tx.select().from(supportSessions).where(pending).limit(1);
    if (!session) return null;
    const [updated] = parsed.data.decision === "approve"
      ? await tx.update(supportSessions).set({ approvedByUserId: context.internalUserId, updatedAt: now }).where(pending).returning()
      : await tx.update(supportSessions).set({ revokedAt: now, updatedAt: now }).where(pending).returning();
    if (!updated) return null;
    await tx.insert(auditEvents).values({
      organisationId: context.organisationId,
      actorUserId: context.internalUserId,
      supportSessionId: id,
      action: parsed.data.decision === "approve" ? "support.session_approved" : "support.session_denied",
      resourceType: "support_session",
      resourceId: id,
      metadata: { ticketReference: session.ticketReference, permission: session.permission, expiresAt: session.expiresAt.toISOString() },
    });
    return updated;
  });
  if (!result) return problem(409, "support_request_unavailable", "This support request is no longer pending or has expired.");
  return ok({ id: result.id, decision: parsed.data.decision, expiresAt: result.expiresAt.toISOString() });
}
