import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditEvents, createDatabase, practicePacks, practicePackVersions } from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const createVersion = z.object({ version: z.string().trim().min(1).max(40), summary: z.string().trim().min(10).max(2000), requirements: z.array(z.string().trim().min(1).max(500)).max(50).default([]) });

export async function POST(request: Request, route: RouteContext<"/api/platform/practice-packs/[packId]/versions">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, createVersion);
  if (!parsed.success) return problem(400, "invalid_request", "The practice-pack version is invalid.", parsed.error.flatten());
  const { packId } = await route.params;
  if (operator.demo) return ok({ id: crypto.randomUUID(), practicePackId: packId, ...parsed.data, status: "draft" }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [pack] = await db.select({ id: practicePacks.id }).from(practicePacks).where(eq(practicePacks.id, packId)).limit(1);
  if (!pack) return problem(404, "practice_pack_not_found", "The practice pack could not be found.");
  try {
    const [created] = await db.insert(practicePackVersions).values({ practicePackId: packId, version: parsed.data.version, definition: { summary: parsed.data.summary, requirements: parsed.data.requirements } }).returning();
    await db.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: "practice_pack.version_created", resourceType: "practice_pack_version", resourceId: created.id, metadata: { packId, version: created.version } });
    return ok(created);
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return problem(409, "version_exists", "That version already exists for this practice pack.");
    throw error;
  }
}
