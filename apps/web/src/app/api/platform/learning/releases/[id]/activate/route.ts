import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { problem } from "@/lib/api";
import { activateRelease } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Publishes an approved release (or re-activates a superseded one) as the single active shared release. */
export async function POST(_request: Request, route: RouteContext<"/api/platform/learning/releases/[id]/activate">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "release_manager") return problem(403, "forbidden", "Only release managers can do this.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The release could not be found.");
  return learningRoute(() => activateRelease(operator, id));
}
