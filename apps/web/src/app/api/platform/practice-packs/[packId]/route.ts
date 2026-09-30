import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditEvents, createDatabase, practicePacks } from "@fieldnote/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const updatePack = z.object({ active: z.boolean() });

export async function PATCH(request: Request, route: RouteContext<"/api/platform/practice-packs/[packId]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, updatePack);
  if (!parsed.success) return problem(400, "invalid_request", "The practice-pack change is invalid.", parsed.error.flatten());
  const { packId } = await route.params;
  if (operator.demo) return ok({ id: packId, active: parsed.data.active }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [updated] = await db.update(practicePacks).set({ active: parsed.data.active, updatedAt: new Date() }).where(eq(practicePacks.id, packId)).returning();
  if (!updated) return problem(404, "practice_pack_not_found", "The practice pack could not be found.");
  await db.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: parsed.data.active ? "practice_pack.activated" : "practice_pack.deactivated", resourceType: "practice_pack", resourceId: packId });
  return ok(updated);
}
