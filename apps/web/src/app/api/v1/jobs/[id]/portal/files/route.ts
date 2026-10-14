import { z } from "zod";
import { apiContext } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { PortalError, shareFile, shareInput, unshareFile } from "@/lib/client-portal";

const failure = (error: unknown) => { if (error instanceof PortalError) return problem(error.status, error.code, error.message); throw error; };
async function guarded(request: Request) {
  const context = await apiContext(request);
  if (!context) return { response: problem(401, "unauthorised", "Sign in required.") };
  const denial = await workspaceApiGuard(request, context);
  if (denial) return { response: denial };
  if (context.accessLevel !== "full") return { response: problem(403, "read_only", "Changes require an active workspace.") };
  return { context };
}

/** Shares a survey photo, video or certificate in the client's portal. */
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/portal/files">) {
  const { context, response } = await guarded(request);
  if (!context) return response;
  const parsed = await parseBody(request, shareInput);
  if (!parsed.success) return problem(422, "invalid_file", "Choose a file, its type and a title the client will see.");
  const { id } = await route.params;
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data, sharedAt: new Date().toISOString() }, { demo: true, persisted: false });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try { return ok(await shareFile(context, id, parsed.data)); } catch (error) { return failure(error); }
}

/** Stops sharing a file. */
export async function DELETE(request: Request, route: RouteContext<"/api/v1/jobs/[id]/portal/files">) {
  const { context, response } = await guarded(request);
  if (!context) return response;
  const parsed = await parseBody(request, z.object({ fileId: z.string().min(1).max(64) }));
  if (!parsed.success) return problem(422, "invalid_file", "Choose a shared file.");
  const { id } = await route.params;
  if (context.demo) return ok({ id: parsed.data.fileId }, { demo: true, persisted: false });
  const invalid = invalidId(context, id, parsed.data.fileId);
  if (invalid) return invalid;
  try { return ok(await unshareFile(context, id, parsed.data.fileId)); } catch (error) { return failure(error); }
}
