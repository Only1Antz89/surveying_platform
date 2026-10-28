import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import {
  canManageEngagement,
  completeFollowupInput,
} from "@/lib/customer-lifecycle";
import { completeFollowup, EngagementError } from "@/lib/customer-followups";
export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  const c = await platformApiContext();
  if (!c) return problem(401, "unauthorised", "Platform access required.");
  if (!canManageEngagement(c.role))
    return problem(403, "forbidden", "Customer engagement access required.");
  if (c.demo)
    return problem(
      409,
      "preview_only",
      "Follow-ups require the connected platform database.",
    );
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success)
    return problem(404, "not_found", "Follow-up not found.");
  const parsed = await parseBody(request, completeFollowupInput);
  if (!parsed.success)
    return problem(
      422,
      "invalid_outcome",
      "Choose an outcome and add a note of 5–1000 characters.",
    );
  try {
    return ok(await completeFollowup(id, parsed.data, c));
  } catch (error) {
    if (error instanceof EngagementError)
      return problem(error.status, "followup_failed", error.message);
    throw error;
  }
}
