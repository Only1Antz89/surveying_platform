import { z } from "zod";
import { ok, problem } from "@/lib/api";
import { mobileContext } from "@/lib/mobile-access";
import { mobileCapture } from "@/lib/mobile-capture";

/** Survey capture outline for an assigned job: inspectable elements, their status and recorded rooms. */
export async function GET(request: Request, route: RouteContext<"/api/mobile/jobs/[id]/capture">) {
  const context = await mobileContext(request);
  if (!context) return problem(401, "unauthorised", "An authorised mobile surveyor session is required.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The job could not be found.");
  const capture = await mobileCapture(context, id);
  return capture ? ok(capture) : problem(404, "not_found", "The job could not be found or is not assigned to you.");
}
