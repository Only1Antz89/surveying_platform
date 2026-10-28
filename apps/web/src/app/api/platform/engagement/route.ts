import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { canManageEngagement, followupInput } from "@/lib/customer-lifecycle";
import {
  loadLifecycleData,
  lifecycleCsv,
  filterLifecycleData,
} from "@/lib/customer-lifecycle-data";
import { createFollowup, EngagementError } from "@/lib/customer-followups";
export async function GET(request: Request) {
  const c = await platformApiContext();
  if (!c) return problem(401, "unauthorised", "Platform access required.");
  if (!canManageEngagement(c.role))
    return problem(403, "forbidden", "Customer engagement access required.");
  const params = new URL(request.url).searchParams;
  const data = await loadLifecycleData(
    params.get("demo") === "include",
    c.demo,
  );
  if (params.get("format") === "csv")
    return new Response(lifecycleCsv(filterLifecycleData(data, params)), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition":
          'attachment; filename="surveynt-customer-engagement.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  return ok(data);
}
export async function POST(request: Request) {
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
  const parsed = await parseBody(request, followupInput);
  if (!parsed.success)
    return problem(
      422,
      "invalid_followup",
      "Choose a customer, active owner, due date and a note of 5–1000 characters.",
    );
  try {
    return ok(await createFollowup(parsed.data, c));
  } catch (error) {
    if (error instanceof EngagementError)
      return problem(error.status, "followup_failed", error.message);
    throw error;
  }
}
