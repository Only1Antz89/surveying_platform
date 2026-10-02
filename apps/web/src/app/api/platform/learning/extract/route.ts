import { platformApiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { runLearningSweep } from "@/lib/learning-pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Runs the learning sweep now: pending withdrawals always, extraction only while the programme is active. */
export async function POST() {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "An active platform staff account is required.");
  if (operator.role !== "release_manager" && operator.role !== "super_admin") return problem(403, "forbidden", "Release manager or super-admin access is required.");
  if (operator.demo) return ok({ withdrawals: 0, firms: 0, created: 0 }, { demo: true });
  return ok(await runLearningSweep());
}
