import { demoStore, recordDemoAudit } from "@/lib/demo-store";
import { z } from "zod";
import { auditEvents, backgroundJobs, createDatabase, organisationMemberships, organisations, platformStaff, supportSessions, users } from "@surveynt/db";
import { and, eq } from "drizzle-orm";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { applicationUrl } from "@/lib/email";

const requestSchema = z.object({
  ticketReference: z.string().trim().min(3).max(80),
  reason: z.string().trim().min(10).max(500),
  permission: z.enum(["read", "write"]).default("read"),
  breakGlass: z.boolean().default(false),
});

export async function POST(request: Request, route: RouteContext<"/api/platform/tenants/[tenantId]/support-sessions">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "Platform staff authentication is required.");
  if (operator.role !== "super_admin" && operator.role !== "support") return problem(403, "forbidden", "Your platform role cannot request customer support access.");
  const parsed = await parseBody(request, requestSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The support request is invalid.", parsed.error.flatten());
  const { tenantId } = await route.params;
  if (parsed.data.breakGlass && operator.role !== "super_admin") return problem(403, "forbidden", "Only a super administrator can start emergency support access.");
  const permission = parsed.data.breakGlass ? "write" : parsed.data.permission;
  if (operator.demo) return demoStore.mutate(state => {
    if (!state.tenants.some(tenant => tenant.id === tenantId)) return problem(404, "tenant_not_found", "The customer account could not be found.");
    const session = { id: crypto.randomUUID(), organisationId: tenantId, platformStaffId: operator.platformStaffId, ...parsed.data, permission, requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (parsed.data.breakGlass ? 15 : 60) * 60000).toISOString(), approvedByUserId: null, revokedAt: null };
    state.sessions.push(session);
    recordDemoAudit(state, tenantId, session.breakGlass ? "support.break_glass_started" : "support.session_requested", "support_session", session.id, { reason: session.reason, permission });
    const pendingApproval = permission === "write" && !session.breakGlass;
    return ok({ ...session, pendingApproval, url: pendingApproval ? null : `/platform/support/${session.id}` }, { demo: true, persisted: true });
  });
  if (!z.uuid().safeParse(tenantId).success) return problem(404, "tenant_not_found", "The customer account could not be found.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [tenant] = await db.select({ id: organisations.id, name: organisations.name, slug: organisations.slug }).from(organisations).where(eq(organisations.id, tenantId)).limit(1);
  if (!tenant) return problem(404, "tenant_not_found", "The customer account could not be found.");
  const expiresAt = new Date(Date.now() + (parsed.data.breakGlass ? 15 : 60) * 60 * 1000);
  return db.transaction(async tx => {
    const [session] = await tx.insert(supportSessions).values({ organisationId: tenantId, platformStaffId: operator.platformStaffId, ticketReference: parsed.data.ticketReference, reason: parsed.data.reason, permission, expiresAt, breakGlass: parsed.data.breakGlass }).returning();
    await tx.insert(auditEvents).values({ organisationId: tenantId, platformStaffId: operator.platformStaffId, supportSessionId: session.id, action: parsed.data.breakGlass ? "support.break_glass_started" : "support.session_requested", resourceType: "support_session", resourceId: session.id, metadata: { ticketReference: session.ticketReference, reason: session.reason, permission: session.permission, expiresAt: session.expiresAt.toISOString(), breakGlass: session.breakGlass } });
    if (permission === "write") {
      const owners = await tx.select({ email: users.email }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(eq(organisationMemberships.organisationId, tenantId), eq(organisationMemberships.role, "owner"), eq(organisationMemberships.active, true)));
      const administrators = parsed.data.breakGlass
        ? await tx.select({ email: users.email }).from(platformStaff).innerJoin(users, eq(platformStaff.clerkUserId, users.clerkUserId)).where(and(eq(platformStaff.role, "super_admin"), eq(platformStaff.active, true)))
        : [];
      const recipients = [...new Set([...owners, ...administrators].map((person) => person.email))];
      if (recipients.length) await tx.insert(backgroundJobs).values(parsed.data.breakGlass ? {
        organisationId: tenantId,
        queue: "email",
        type: "support_break_glass_notification",
        deduplicationKey: `support-break-glass:${session.id}`,
        payload: { recipients, organisationName: tenant.name, ticketReference: session.ticketReference, reason: session.reason, expiresAt: session.expiresAt.toISOString() },
      } : {
        organisationId: tenantId,
        queue: "email",
        type: "support_approval_requested",
        deduplicationKey: `support-approval:${session.id}`,
        payload: { recipients, organisationName: tenant.name, ticketReference: session.ticketReference, reason: session.reason, approvalUrl: `${applicationUrl()}/app/${tenant.slug}/team`, expiresAt: session.expiresAt.toISOString() },
      }).onConflictDoNothing();
    }
    const pendingApproval = session.permission === "write" && !session.breakGlass;
    return ok({ id: session.id, permission: session.permission, expiresAt: session.expiresAt.toISOString(), pendingApproval, breakGlass: session.breakGlass, url: pendingApproval ? null : `/platform/support/${session.id}` });
  });
}
