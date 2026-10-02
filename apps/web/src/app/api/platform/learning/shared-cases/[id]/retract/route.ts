import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { retractSharedCase } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Retracts a released case from every release; with reviewAgain it returns to review as a correction. */
export async function POST(request: Request, route: RouteContext<"/api/platform/learning/shared-cases/[id]/retract">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  const parsed = await parseBody(request, z.object({ reason: z.string().trim().min(10).max(2000), reviewAgain: z.boolean() }));
  if (!parsed.success) return problem(400, "invalid_request", "Record why the case is retracted.", parsed.error.flatten());
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The shared case could not be found.");
  return learningRoute(() => retractSharedCase(operator, id, parsed.data));
}
