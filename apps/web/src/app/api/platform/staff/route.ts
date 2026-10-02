import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditEvents, createDatabase, platformStaff, users } from "@surveynt/db";
import { platformRoles } from "@surveynt/domain";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const createStaff = z.object({
  email: z.email(),
  role: z.enum(platformRoles),
});

export async function POST(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin") return problem(403, "forbidden", "Only a super administrator can grant platform access.");
  const parsed = await parseBody(request, createStaff);
  if (!parsed.success) return problem(400, "invalid_request", "The platform access details are invalid.", parsed.error.flatten());
  const email = parsed.data.email.trim().toLowerCase();
  if (operator.demo) return ok({ id: crypto.randomUUID(), email, role: parsed.data.role, active: true }, { demo: true, persisted: false });

  const clerk = await clerkClient();
  const matches = await clerk.users.getUserList({ emailAddress: [email], limit: 10 });
  const clerkUser = matches.data.find((candidate) => candidate.emailAddresses.some((address) => address.emailAddress.toLowerCase() === email));
  const verifiedAddress = clerkUser?.emailAddresses.find((address) => address.emailAddress.toLowerCase() === email && address.verification?.status === "verified");
  if (!clerkUser || !verifiedAddress) return problem(404, "verified_user_not_found", "That email does not belong to an existing verified Surveynt account.");

  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [existing] = await db.select({ id: platformStaff.id, active: platformStaff.active }).from(platformStaff).where(eq(platformStaff.clerkUserId, clerkUser.id)).limit(1);
  if (existing?.active) return problem(409, "staff_access_exists", "That account already has active platform access.");
  const [created] = await db.transaction(async (tx) => {
    await tx.insert(users).values({ clerkUserId: clerkUser.id, email, firstName: clerkUser.firstName, lastName: clerkUser.lastName }).onConflictDoUpdate({ target: users.clerkUserId, set: { email, firstName: clerkUser.firstName, lastName: clerkUser.lastName, updatedAt: new Date() } });
    const [staff] = await tx.insert(platformStaff).values({ clerkUserId: clerkUser.id, role: parsed.data.role, active: true }).onConflictDoUpdate({ target: platformStaff.clerkUserId, set: { role: parsed.data.role, active: true, updatedAt: new Date() } }).returning();
    await tx.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: existing ? "platform_staff.reactivated" : "platform_staff.granted", resourceType: "platform_staff", resourceId: staff.id, metadata: { email, role: parsed.data.role } });
    return [staff];
  });
  return ok(created);
}
