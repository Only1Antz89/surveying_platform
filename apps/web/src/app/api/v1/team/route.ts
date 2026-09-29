import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { members } from "@/lib/demo-data";

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  return ok(members, { demo: context.demo });
}
