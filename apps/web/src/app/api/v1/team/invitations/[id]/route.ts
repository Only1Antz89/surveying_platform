import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { canManageTeam } from "@surveynt/domain";
import { auditEvents, createDatabase, invitations } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";

async function pendingInvitation(organisationId: string, id: string) {
  const db = createDatabase();
  const [invitation] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisationId}, true)`);
    return tx.select().from(invitations).where(and(eq(invitations.id, id), eq(invitations.organisationId, organisationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).limit(1);
  });
  return invitation;
}

export async function DELETE(request: Request, route: RouteContext<"/api/v1/team/invitations/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing team access.");
  if (!canManageTeam(context.role)) return problem(403, "forbidden", "Only owners and administrators can revoke invitations.");
  const { id } = await route.params;
  if (context.demo) return ok({ id, revoked: true }, { demo: true, persisted: false });
  const invitation = await pendingInvitation(context.organisationId, id);
  if (!invitation) return problem(404, "invitation_not_found", "The pending invitation could not be found.");
  if (invitation.clerkInvitationId) {
    const clerk = await clerkClient();
    await clerk.organizations.revokeOrganizationInvitation({ organizationId: context.clerkOrganisationId, invitationId: invitation.clerkInvitationId, requestingUserId: context.userId });
  }
  const db = createDatabase();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    await tx.update(invitations).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(invitations.id, id), eq(invitations.organisationId, context.organisationId)));
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "invitation.revoked", resourceType: "invitation", resourceId: id, metadata: { email: invitation.email } });
  });
  return ok({ id, revoked: true });
}

export async function POST(request: Request, route: RouteContext<"/api/v1/team/invitations/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing team access.");
  if (!canManageTeam(context.role)) return problem(403, "forbidden", "Only owners and administrators can resend invitations.");
  const { id } = await route.params;
  if (context.demo) return ok({ id: crypto.randomUUID(), resentFrom: id }, { demo: true, persisted: false });
  const invitation = await pendingInvitation(context.organisationId, id);
  if (!invitation) return problem(404, "invitation_not_found", "The pending invitation could not be found.");
  const clerk = await clerkClient();
  if (invitation.clerkInvitationId) {
    await clerk.organizations.revokeOrganizationInvitation({ organizationId: context.clerkOrganisationId, invitationId: invitation.clerkInvitationId, requestingUserId: context.userId });
  }
  const clerkRole = invitation.role === "owner" || invitation.role === "administrator" ? "org:admin" : "org:member";
  const replacement = await clerk.organizations.createOrganizationInvitation({ organizationId: context.clerkOrganisationId, emailAddress: invitation.email, role: clerkRole, inviterUserId: context.userId, expiresInDays: 14, publicMetadata: { surveyntRole: invitation.role } });
  const db = createDatabase();
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    await tx.update(invitations).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(invitations.id, id), eq(invitations.organisationId, context.organisationId)));
    const [record] = await tx.insert(invitations).values({ organisationId: context.organisationId, clerkInvitationId: replacement.id, email: invitation.email, role: invitation.role, expiresAt: new Date(replacement.expiresAt) }).returning();
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "invitation.resent", resourceType: "invitation", resourceId: record.id, metadata: { email: invitation.email, previousInvitationId: id } });
    return [record];
  });
  return ok(created);
}
