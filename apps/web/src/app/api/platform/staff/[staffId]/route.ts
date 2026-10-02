import { z } from "zod";
import { and, count, eq, ne } from "drizzle-orm";
import { auditEvents, createDatabase, platformStaff, users } from "@surveynt/db";
import { platformRoles } from "@surveynt/domain";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const updateStaff = z.object({
  role: z.enum(platformRoles).optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export async function PATCH(request: Request, route: RouteContext<"/api/platform/staff/[staffId]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin") return problem(403, "forbidden", "Only a super administrator can change platform access.");
  const parsed = await parseBody(request, updateStaff);
  if (!parsed.success) return problem(400, "invalid_request", "The platform access change is invalid.", parsed.error.flatten());
  const { staffId } = await route.params;
  if (operator.demo) return ok({ id: staffId, ...parsed.data }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ staff: platformStaff, email: users.email }).from(platformStaff).leftJoin(users, eq(users.clerkUserId, platformStaff.clerkUserId)).where(eq(platformStaff.id, staffId)).limit(1);
    if (!current) return { kind: "missing" as const };
    const removesSuperAdmin = current.staff.role === "super_admin" && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== "super_admin"));
    if (current.staff.clerkUserId === operator.userId && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== "super_admin"))) return { kind: "self" as const };
    if (removesSuperAdmin) {
      const [remaining] = await tx.select({ value: count(platformStaff.id) }).from(platformStaff).where(and(eq(platformStaff.role, "super_admin"), eq(platformStaff.active, true), ne(platformStaff.id, staffId)));
      if ((remaining?.value ?? 0) < 1) return { kind: "final_super_admin" as const };
    }
    const [updated] = await tx.update(platformStaff).set({ role: parsed.data.role, active: parsed.data.active, updatedAt: new Date() }).where(eq(platformStaff.id, staffId)).returning();
    await tx.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: parsed.data.active === false ? "platform_staff.revoked" : parsed.data.active === true && !current.staff.active ? "platform_staff.reactivated" : "platform_staff.role_changed", resourceType: "platform_staff", resourceId: staffId, metadata: { email: current.email, previousRole: current.staff.role, role: updated.role, previousActive: current.staff.active, active: updated.active } });
    return { kind: "updated" as const, staff: updated };
  });
  if (result.kind === "missing") return problem(404, "staff_not_found", "The platform operator could not be found.");
  if (result.kind === "self") return problem(400, "self_lockout", "You cannot remove or reduce your own super-administrator access.");
  if (result.kind === "final_super_admin") return problem(400, "final_super_admin", "At least one active super administrator must remain.");
  return ok(result.staff);
}
