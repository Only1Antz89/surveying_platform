import { z } from "zod";
import { eq } from "drizzle-orm";
import { canManageTenants } from "@fieldnote/domain";
import { auditEvents, createDatabase, organisations } from "@fieldnote/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const statusChange = z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(10).max(500) });

export async function PATCH(request: Request, route: RouteContext<"/api/platform/tenants/[tenantId]/status">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (!canManageTenants(operator.role)) return problem(403, "forbidden", "Only super administrators can change tenant access.");
  const parsed = await parseBody(request, statusChange);
  if (!parsed.success) return problem(400, "invalid_request", "A status and a reason of at least 10 characters are required.", parsed.error.flatten());
  const { tenantId } = await route.params;
  if (operator.demo) return ok({ id: tenantId, ...parsed.data }, { demo: true, persisted: false });
  if (!process.env.DATABASE_ADMIN_URL) return problem(503, "platform_database_unavailable", "Platform operations are not configured.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: organisations.id, status: organisations.status }).from(organisations).where(eq(organisations.id, tenantId)).limit(1);
    if (!current) return null;
    const [updated] = await tx.update(organisations).set({ status: parsed.data.status, suspendedReason: parsed.data.status === "suspended" ? parsed.data.reason : null, updatedAt: new Date() }).where(eq(organisations.id, tenantId)).returning({ id: organisations.id, status: organisations.status, suspendedReason: organisations.suspendedReason });
    await tx.insert(auditEvents).values({ organisationId: tenantId, platformStaffId: operator.platformStaffId, action: parsed.data.status === "suspended" ? "tenant.suspended" : "tenant.reactivated", resourceType: "organisation", resourceId: tenantId, metadata: { reason: parsed.data.reason, previousStatus: current.status } });
    return updated;
  });
  if (!result) return problem(404, "tenant_not_found", "The tenant could not be found.");
  return ok(result);
}
