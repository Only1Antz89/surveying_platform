import { z } from "zod";
import { apiContext } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { jobMessageLog, MessageError, sendJobMessage } from "@/lib/client-messages";

export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/messages">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  const { id } = await route.params;
  if (context.demo) return ok({ log: id === "job_01" ? [{ templateKey: "appointment_reminder", channel: "email", status: "queued", reason: null, createdAt: new Date(Date.now() - 20 * 36e5).toISOString() }] : [], available: ["on_the_way", "access_request"] }, { demo: true });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const data = await jobMessageLog(context, id);
  return data ? ok(data) : problem(404, "not_found", "The job could not be found.");
}
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/messages">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full") return problem(403, "read_only", "Messaging requires an active workspace.");
  const parsed = await parseBody(request, z.object({ key: z.enum(["on_the_way", "access_request"]) }));
  if (!parsed.success) return problem(422, "invalid_message", "Choose a message to send.");
  const { id } = await route.params;
  if (context.demo) return ok([{ channel: "email", status: "queued", reason: null }], { demo: true, persisted: false });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try { return ok(await sendJobMessage(context, id, parsed.data.key)); }
  catch (error) { if (error instanceof MessageError) return problem(error.status, error.code, error.message); throw error; }
}
