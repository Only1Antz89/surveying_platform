import {workspaceAudit} from "@/lib/workspace-audit";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, createDatabase, organisationMemberships, withTenant } from "@surveynt/db";
import { canReceiveProfessionalPermissions, professionalPermissions } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const change = z.object({ permission: z.enum(professionalPermissions), enabled: z.boolean(), reason: z.string().trim().min(5).max(1000) }).strict();

export async function PATCH(request: Request, route: RouteContext<"/api/v1/team/[id]/permissions">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to an active practice.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.role !== "owner") return problem(403, "owner_required", "Only an owner can grant or revoke professional permissions.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "This workspace is read only.");
  const parsed = await parseBody(request, change);
  if (!parsed.success) return problem(400, "invalid_permission", "Choose a permission and give a reason of at least five characters.");
  const { id } = await route.params;
  if (context.demo) return problem(409, "persistent_membership_required", "Professional grants require a signed-in, persistent practice membership. This design preview cannot grant permissions.");
  if (!z.uuid().safeParse(id).success) return problem(404, "member_not_found", "The member could not be found.");
  const result = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    // Serialize role changes and grants for this practice. Recheck the granting owner's current membership.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${context.organisationId + ":membership-permissions"}, 0))`);
    const [owner] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, context.internalUserId!), eq(organisationMemberships.active, true))).for("update").limit(1);
    if (owner?.role !== "owner") return "forbidden" as const;
    const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.id, id), eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.active, true))).for("update").limit(1);
    if (!member) return "missing" as const;
    if (!canReceiveProfessionalPermissions(member.role)) return "ineligible" as const;
    if (member.role === "surveyor" && parsed.data.permission === "record_survey" && !parsed.data.enabled) return "inherited" as const;
    const column = parsed.data.permission === "record_survey" ? "canRecordSurvey" : "canApproveReports";
    const [updated] = await tx.update(organisationMemberships).set({ [column]: parsed.data.enabled, updatedAt: new Date() }).where(eq(organisationMemberships.id, member.id)).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: parsed.data.enabled ? "membership.professional_permission_granted" : "membership.professional_permission_revoked", resourceType: "membership", resourceId: member.id, metadata: { recipientUserId: member.userId, permission: parsed.data.permission, previous: member[column], enabled: parsed.data.enabled, reason: parsed.data.reason, grantedAt: new Date().toISOString() } }));
    return { id: updated.id, canRecordSurvey: updated.canRecordSurvey, canApproveReports: updated.canApproveReports };
  });
  if (result === "forbidden") return problem(403, "owner_required", "Your owner access has changed. Reload before continuing.");
  if (result === "missing") return problem(404, "member_not_found", "The active member could not be found.");
  if (result === "ineligible") return problem(422, "ineligible_role", "Only owners, administrators, managers and surveyors can hold professional permissions.");
  if (result === "inherited") return problem(422, "inherited_recording", "Surveyors record their assigned work by role. Remove the assignment, change their role or deactivate membership to remove that access.");
  return ok(result);
}
