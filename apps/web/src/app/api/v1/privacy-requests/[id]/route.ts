import { z } from "zod";
import { apiContext } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { completeAccessRequest, completeErasureRequest, PrivacyError, refuseRequest } from "@/lib/data-protection";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("export") }),
  z.object({ action: z.literal("erase"), confirm: z.literal(true) }),
  z.object({ action: z.literal("refuse"), reason: z.string().trim().min(10).max(2000) }),
]);

/** Completes a request: export the person's data, erase it, or refuse with a recorded reason. */
export async function POST(request: Request, route: RouteContext<"/api/v1/privacy-requests/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full" || !["owner", "administrator"].includes(context.role)) return problem(403, "forbidden", "Owner or administrator access is required.");
  const parsed = await parseBody(request, action);
  if (!parsed.success) return problem(422, "invalid_action", "Choose export, erase (with confirmation) or refuse with a reason.");
  const { id } = await route.params;
  if (context.demo) return problem(409, "preview_only", "Data protection requests are handled in a configured practice.");
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try {
    if (parsed.data.action === "export") {
      const bundle = await completeAccessRequest(context, id);
      return new Response(JSON.stringify(bundle, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="subject-access-${id.slice(0, 8)}.json"`, "cache-control": "private, no-store" } });
    }
    return ok(parsed.data.action === "erase" ? await completeErasureRequest(context, id) : await refuseRequest(context, id, parsed.data.reason));
  } catch (error) { if (error instanceof PrivacyError) return problem(error.status, error.code, error.message); throw error; }
}
