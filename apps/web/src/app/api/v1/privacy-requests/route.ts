import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { listRequests, openRequest, PrivacyError, requestInput } from "@/lib/data-protection";

const owners = new Set(["owner", "administrator"]);
async function guarded(request: Request, write: boolean) {
  const context = await apiContext(request);
  if (!context) return { response: problem(401, "unauthorised", "Sign in required.") };
  const denial = await workspaceApiGuard(request, context);
  if (denial) return { response: denial };
  if (!owners.has(context.role)) return { response: problem(403, "forbidden", "Owner or administrator access is required for data protection requests.") };
  if (write && context.accessLevel !== "full") return { response: problem(403, "read_only", "Changes require an active workspace.") };
  return { context };
}

/** Data protection requests, newest first. */
export async function GET(request: Request) {
  const { context, response } = await guarded(request, false);
  if (!context) return response;
  return ok(context.demo ? [] : await listRequests(context), context.demo ? { demo: true } : {});
}

/** Records an access or erasure request and returns what the practice holds for that email. */
export async function POST(request: Request) {
  const { context, response } = await guarded(request, true);
  if (!context) return response;
  const parsed = await parseBody(request, requestInput);
  if (!parsed.success) return problem(422, "invalid_request", "Enter the person's email address and the type of request.");
  if (context.demo) return problem(409, "preview_only", "Data protection requests are recorded in a configured practice.");
  try { return ok(await openRequest(context, parsed.data)); }
  catch (error) { if (error instanceof PrivacyError) return problem(error.status, error.code, error.message); throw error; }
}
