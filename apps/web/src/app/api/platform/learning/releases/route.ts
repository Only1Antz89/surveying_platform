import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { createReleaseDraft } from "@/lib/learning-admin";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Curates every technically approved case into a draft release with its manifest and any problems. */
export async function POST(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "release_manager") return problem(403, "forbidden", "Only release managers can prepare releases.");
  const parsed = await parseBody(request, z.object({ version: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,30}$/) }));
  if (!parsed.success) return problem(400, "invalid_request", "The release version is invalid.", parsed.error.flatten());
  return learningRoute(() => createReleaseDraft(operator, parsed.data));
}
