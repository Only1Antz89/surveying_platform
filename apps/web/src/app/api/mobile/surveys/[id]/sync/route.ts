import { z } from "zod";
import { syncOperationSchema } from "@surveynt/assistant";
import { ok, parseBody, problem } from "@/lib/api";
import { mobileContext } from "@/lib/mobile-access";
import { surveyContextFor } from "@/lib/mobile-capture";
import { applySyncOperations } from "@/lib/surveys";

// The companion records inspection status, site notes and photo links. Professional
// field answers and report wording stay in the full survey workspace.
const mobileOperation = syncOperationSchema.refine((operation) => ["set_element", "add_observation", "link_evidence"].includes(operation.type), "Use the survey workspace for this change.");

export async function POST(request: Request, route: RouteContext<"/api/mobile/surveys/[id]/sync">) {
  const context = await mobileContext(request);
  if (!context) return problem(401, "unauthorised", "An authorised mobile surveyor session is required.");
  const parsed = await parseBody(request, z.object({ operations: z.array(mobileOperation).min(1).max(50) }));
  if (!parsed.success) return problem(422, "invalid_operations", "The queued changes could not be read. Update the app and try again.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  return ok(await applySyncOperations(surveyContextFor(context), id, parsed.data.operations));
}
