import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { problem } from "@/lib/api";
import { canManageLearningPolicy, publishPolicy } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Publishes a draft (privacy assessment reference and complete release criteria required); retires the previous version. */
export async function POST(_request: Request, route: RouteContext<"/api/platform/learning/policies/[id]/publish">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (!canManageLearningPolicy(operator.role)) return problem(403, "forbidden", "Compliance or super-admin access is required.");
  const { id } = await route.params;
  if (operator.demo) return problem(409, "demo", "Demo workspace: policies cannot be published.");
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The policy version could not be found.");
  return learningRoute(() => publishPolicy(operator, id));
}
