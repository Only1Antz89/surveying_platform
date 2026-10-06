import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { canManageTeam, organisationRoles } from "@surveynt/domain";
import { auditEvents, createDatabase, invitations, onboardingSteps } from "@surveynt/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const invitationSchema = z.object({ email: z.email(), role: z.enum(organisationRoles) });

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing team access.");
  if (!canManageTeam(context.role)) return problem(403, "forbidden", "Only owners and administrators can invite teammates.");
  const parsed = await parseBody(request, invitationSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The invitation details are invalid.", parsed.error.flatten());
  const email = parsed.data.email.trim().toLowerCase();
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data, email, status: "pending" }, { demo: true, persisted: false });
  const db = createDatabase();
  const [existing] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select({ id: invitations.id }).from(invitations).where(and(eq(invitations.organisationId, context.organisationId), eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).limit(1);
  });
  if (existing) return problem(409, "invitation_exists", "A pending invitation already exists for that email address.");
  const clerk = await clerkClient();
  const role = parsed.data.role === "owner" || parsed.data.role === "administrator" ? "org:admin" : "org:member";
  const invitation = await clerk.organizations.createOrganizationInvitation({ organizationId: context.clerkOrganisationId, emailAddress: email, role, inviterUserId: context.userId, expiresInDays: 14, publicMetadata: { surveyntRole: parsed.data.role } });
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [record] = await tx.insert(invitations).values({ organisationId: context.organisationId, clerkInvitationId: invitation.id, email, role: parsed.data.role, expiresAt: new Date(invitation.expiresAt) }).returning();
    await tx.insert(onboardingSteps).values({ organisationId: context.organisationId, key: "first_teammate", completedAt: new Date(), completedByUserId: context.internalUserId }).onConflictDoUpdate({ target: [onboardingSteps.organisationId, onboardingSteps.key], set: { completedAt: new Date(), completedByUserId: context.internalUserId, updatedAt: new Date() } });
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "invitation.created", resourceType: "invitation", resourceId: record.id, metadata: { email, role: parsed.data.role } });
    return [record];
  });
  return ok(created);
}
