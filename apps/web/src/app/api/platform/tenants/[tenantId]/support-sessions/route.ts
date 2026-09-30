import { z } from "zod";
import { auditEvents, createDatabase, organisations, supportSessions } from "@fieldnote/db";
import { eq } from "drizzle-orm";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const requestSchema = z.object({
  ticketReference: z.string().trim().min(3).max(80),
  reason: z.string().trim().min(10).max(500),
  permission: z.enum(["read", "write"]).default("read"),
});

export async function POST(request: Request, route: RouteContext<"/api/platform/tenants/[tenantId]/support-sessions">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "Platform staff authentication is required.");
  if (operator.role !== "super_admin" && operator.role !== "support") return problem(403, "forbidden", "Your platform role cannot request customer support access.");
  const parsed = await parseBody(request, requestSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The support request is invalid.", parsed.error.flatten());
  const { tenantId } = await route.params;
  if (operator.demo) return ok({ id: crypto.randomUUID(), permission: parsed.data.permission, pendingApproval: parsed.data.permission === "write" }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [tenant] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, tenantId)).limit(1);
  if (!tenant) return problem(404, "tenant_not_found", "The customer account could not be found.");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const [session] = await db.insert(supportSessions).values({ organisationId: tenantId, platformStaffId: operator.platformStaffId, ticketReference: parsed.data.ticketReference, reason: parsed.data.reason, permission: parsed.data.permission, expiresAt }).returning();
  await db.insert(auditEvents).values({ organisationId: tenantId, platformStaffId: operator.platformStaffId, supportSessionId: session.id, action: "support.session_requested", resourceType: "support_session", resourceId: session.id, metadata: { ticketReference: session.ticketReference, reason: session.reason, permission: session.permission, expiresAt: session.expiresAt.toISOString() } });
  return ok({ id: session.id, permission: session.permission, expiresAt: session.expiresAt.toISOString(), pendingApproval: session.permission === "write", url: session.permission === "read" ? `/platform/support/${session.id}` : null });
}
