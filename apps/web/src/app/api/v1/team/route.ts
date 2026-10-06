import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createDatabase, invitations, organisationMemberships, users } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { members } from "@/lib/demo-data";

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok(members, { demo: true });
  const db = createDatabase();
  const data = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const activeMembers = await tx.select({ membershipId: organisationMemberships.id, userId: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, role: organisationMemberships.role }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.active, true))).orderBy(asc(users.firstName));
    const pendingInvitations = await tx.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt }).from(invitations).where(and(eq(invitations.organisationId, context.organisationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date()))).orderBy(desc(invitations.createdAt));
    return { activeMembers, pendingInvitations };
  });
  return ok(data);
}
