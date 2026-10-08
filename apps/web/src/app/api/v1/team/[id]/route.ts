import {workspaceAudit} from "@/lib/workspace-audit";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { clerkClient } from "@clerk/nextjs/server";
import { and, count, eq, sql } from "drizzle-orm";
import { membershipChangeBlocker, organisationRoles } from "@surveynt/domain";
import { auditEvents, createDatabase, organisationMemberships, users } from "@surveynt/db";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const roleSchema = z.object({ role: z.enum(organisationRoles) });

async function loadMembership(organisationId: string, membershipId: string) {
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisationId}, true)`);
    const [membership] = await tx.select({ id: organisationMemberships.id, role: organisationMemberships.role, userId: organisationMemberships.userId, clerkUserId: users.clerkUserId, email: users.email })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .where(and(eq(organisationMemberships.id, membershipId), eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.active, true)))
      .limit(1);
    const [owners] = await tx.select({ value: count() }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisationId), eq(organisationMemberships.role, "owner"), eq(organisationMemberships.active, true)));
    return { membership, ownerCount: owners?.value ?? 0 };
  });
}

export async function PATCH(request: Request, route: RouteContext<"/api/v1/team/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing team access.");
  const parsed = await parseBody(request, roleSchema);
  if (!parsed.success) return problem(400, "invalid_request", "Select a valid workspace role.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id, role: parsed.data.role }, { demo: true, persisted: false });
  const target = await loadMembership(context.organisationId, id);
  if (!target.membership) return problem(404, "member_not_found", "The active member could not be found.");
  const blocked = membershipChangeBlocker(context.role, target.membership.role, parsed.data.role, target.ownerCount);
  if (blocked === "forbidden") return problem(403, "forbidden", "Only owners and administrators can manage team access.");
  if (blocked === "owner_permission") return problem(403, "forbidden", "Only an owner can manage owner access.");
  if (blocked === "final_owner") return problem(409, "final_owner", "Add another owner before changing the final owner's role.");

  const clerk = await clerkClient();
  const clerkRole = parsed.data.role === "owner" || parsed.data.role === "administrator" ? "org:admin" : "org:member";
  await clerk.organizations.updateOrganizationMembership({ organizationId: context.clerkOrganisationId, userId: target.membership.clerkUserId, role: clerkRole });
  await clerk.organizations.updateOrganizationMembershipMetadata({ organizationId: context.clerkOrganisationId, userId: target.membership.clerkUserId, publicMetadata: { surveyntRole: parsed.data.role } });
  const db = createDatabase();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    await tx.update(organisationMemberships).set({ role: parsed.data.role, canRecordSurvey: false, canApproveReports: false, updatedAt: new Date() }).where(and(eq(organisationMemberships.id, id), eq(organisationMemberships.organisationId, context.organisationId)));
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "membership.role_changed", resourceType: "membership", resourceId: id, metadata: { email: target.membership.email, previousRole: target.membership.role, role: parsed.data.role } }));
  });
  return ok({ id, role: parsed.data.role });
}

export async function DELETE(request: Request, route: RouteContext<"/api/v1/team/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing team access.");
  const { id } = await route.params;
  if (context.demo) return ok({ id, removed: true }, { demo: true, persisted: false });
  const target = await loadMembership(context.organisationId, id);
  if (!target.membership) return problem(404, "member_not_found", "The active member could not be found.");
  const blocked = membershipChangeBlocker(context.role, target.membership.role, null, target.ownerCount);
  if (blocked === "forbidden") return problem(403, "forbidden", "Only owners and administrators can manage team access.");
  if (blocked === "owner_permission") return problem(403, "forbidden", "Only an owner can remove another owner.");
  if (blocked === "final_owner") return problem(409, "final_owner", "The final owner cannot be removed.");

  const clerk = await clerkClient();
  await clerk.organizations.deleteOrganizationMembership({ organizationId: context.clerkOrganisationId, userId: target.membership.clerkUserId });
  const db = createDatabase();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    await tx.update(organisationMemberships).set({ active: false, updatedAt: new Date() }).where(and(eq(organisationMemberships.id, id), eq(organisationMemberships.organisationId, context.organisationId)));
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "membership.removed", resourceType: "membership", resourceId: id, metadata: { email: target.membership.email, role: target.membership.role } }));
  });
  return ok({ id, removed: true });
}
