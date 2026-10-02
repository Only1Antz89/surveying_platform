import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { signOffReleasePrivacy } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** A privacy reviewer signs off a draft release, recording the linkage checks made across releases. */
export async function POST(request: Request, route: RouteContext<"/api/platform/learning/releases/[id]/privacy">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "privacy_reviewer") return problem(403, "forbidden", "Only privacy reviewers can sign off a release.");
  const parsed = await parseBody(request, z.object({ note: z.string().trim().min(10).max(2000) }));
  if (!parsed.success) return problem(400, "invalid_request", "Record what was checked.", parsed.error.flatten());
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The release could not be found.");
  return learningRoute(() => signOffReleasePrivacy(operator, id, parsed.data.note));
}
