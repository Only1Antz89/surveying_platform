import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { rollbackRelease } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Rolls the active release back to the previous one, with a recorded reason. */
export async function POST(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "release_manager") return problem(403, "forbidden", "Only release managers can roll back releases.");
  const parsed = await parseBody(request, z.object({ reason: z.string().trim().min(10).max(2000) }));
  if (!parsed.success) return problem(400, "invalid_request", "Record why the release is rolled back.", parsed.error.flatten());
  return learningRoute(() => rollbackRelease(operator, parsed.data.reason));
}
