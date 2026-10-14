import { z } from "zod";
import { ok, parseBody, problem } from "@/lib/api";
import { mobileContext } from "@/lib/mobile-access";
import { costEntryInput } from "@/lib/job-costs-model";
import { addCostEntry, JobCostError } from "@/lib/job-costs";

/** Logs time, mileage or an expense against an assigned job from site. */
export async function POST(request: Request, route: RouteContext<"/api/mobile/jobs/[id]/costs">) {
  const context = await mobileContext(request);
  if (!context) return problem(401, "unauthorised", "An authorised mobile surveyor session is required.");
  const parsed = await parseBody(request, costEntryInput);
  if (!parsed.success) return problem(422, "invalid_entry", "Enter the time, miles or amount and a date.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The job could not be found.");
  try { return ok(await addCostEntry({ organisationId: context.organisationId, internalUserId: context.userId, role: context.role }, id, parsed.data)); }
  catch (error) { if (error instanceof JobCostError) return problem(error.status, error.code, error.message); throw error; }
}
