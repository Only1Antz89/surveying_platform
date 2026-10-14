import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { listServerErrors, resolveServerError } from "@/lib/error-reporting";

const operations = new Set(["super_admin", "support", "compliance"]);
export async function GET() {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "Platform sign-in required.");
  if (!operations.has(operator.role)) return problem(403, "forbidden", "Operations access required.");
  return ok("demo" in operator && operator.demo ? [] : await listServerErrors());
}
export async function PATCH(request: Request) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "Platform sign-in required.");
  if (!operations.has(operator.role)) return problem(403, "forbidden", "Operations access required.");
  const body = await parseBody(request, z.object({ id: z.uuid() }));
  if (!body.success) return problem(422, "invalid_error", "Choose an error to resolve.");
  if ("demo" in operator && operator.demo) return ok(null, { persisted: false });
  const row = await resolveServerError(body.data.id, operator.platformStaffId);
  return row ? ok(row) : problem(404, "not_found", "The error could not be found.");
}
