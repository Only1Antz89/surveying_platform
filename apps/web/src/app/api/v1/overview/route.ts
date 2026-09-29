import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { jobs } from "@/lib/demo-data";

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  return ok({ activeJobs: 18, inspectionsThisWeek: 7, openClients: 42, feesInProgress: 21400, workQueue: jobs.slice(0, 4) }, { demo: context.demo });
}
