import { z } from "zod";
import { auditEvents, createDatabase, practicePacks, practicePackVersions } from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const createPack = z.object({
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(160),
  discipline: z.string().trim().min(2).max(120),
  version: z.string().trim().min(1).max(40),
  summary: z.string().trim().min(10).max(2000),
  requirements: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});

export async function POST(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "super_admin" && operator.role !== "compliance") return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const parsed = await parseBody(request, createPack);
  if (!parsed.success) return problem(400, "invalid_request", "The practice-pack details are invalid.", parsed.error.flatten());
  if (operator.demo) return ok({ id: crypto.randomUUID(), ...parsed.data, active: true }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  try {
    const created = await db.transaction(async (tx) => {
      const [pack] = await tx.insert(practicePacks).values({ key: parsed.data.key, name: parsed.data.name, discipline: parsed.data.discipline }).returning();
      const [version] = await tx.insert(practicePackVersions).values({ practicePackId: pack.id, version: parsed.data.version, definition: { summary: parsed.data.summary, requirements: parsed.data.requirements } }).returning();
      await tx.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: "practice_pack.created", resourceType: "practice_pack", resourceId: pack.id, metadata: { key: pack.key, version: version.version } });
      return { ...pack, versions: [version] };
    });
    return ok(created);
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return problem(409, "practice_pack_exists", "That practice-pack key or version is already in use.");
    throw error;
  }
}
