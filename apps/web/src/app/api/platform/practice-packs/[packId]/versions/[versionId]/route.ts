import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, practicePackVersions } from "@fieldnote/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const publishVersion = z.object({ status: z.literal("published") });

export async function PATCH(request: Request, route: RouteContext<"/api/platform/practice-packs/[packId]/versions/[versionId]">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, publishVersion);
  if (!parsed.success) return problem(400, "invalid_request", "Only draft versions can be published.", parsed.error.flatten());
  const { packId, versionId } = await route.params;
  if (operator.demo) return ok({ id: versionId, practicePackId: packId, status: "published", publishedAt: new Date().toISOString() }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [current] = await db.select().from(practicePackVersions).where(and(eq(practicePackVersions.id, versionId), eq(practicePackVersions.practicePackId, packId))).limit(1);
  if (!current) return problem(404, "version_not_found", "The practice-pack version could not be found.");
  if (current.status === "published") return ok(current);
  const [updated] = await db.update(practicePackVersions).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(practicePackVersions.id, versionId), eq(practicePackVersions.practicePackId, packId), eq(practicePackVersions.status, "draft"))).returning();
  if (!updated) return problem(409, "version_not_draft", "Only a draft practice-pack version can be published.");
  await db.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: "practice_pack.version_published", resourceType: "practice_pack_version", resourceId: versionId, metadata: { packId, version: updated.version } });
  return ok(updated);
}
