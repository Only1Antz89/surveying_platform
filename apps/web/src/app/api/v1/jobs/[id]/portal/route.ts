import { z } from "zod";
import { apiContext } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { createPortalLink, portalAdmin, PortalError, revokePortal, sendPortalLink } from "@/lib/client-portal";
import { demoPortalAdmin } from "@/lib/demo-portal";

const failure = (error: unknown) => { if (error instanceof PortalError) return problem(error.status, error.code, error.message); throw error; };
const action = z.discriminatedUnion("action", [z.object({ action: z.literal("send"), email: z.email().max(254).nullable().optional() }), z.object({ action: z.literal("link") })]);

/** Portal link status and shared files for a job. */
export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/portal">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  const { id } = await route.params;
  if (context.demo) return ok(demoPortalAdmin(id), { demo: true });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const data = await portalAdmin(context, id);
  return data ? ok(data) : problem(404, "not_found", "The job could not be found.");
}

/** Emails the client a fresh portal link, or creates one to copy. Either replaces the previous link. */
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/portal">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full") return problem(403, "read_only", "Changes require an active workspace.");
  const parsed = await parseBody(request, action);
  if (!parsed.success) return problem(422, "invalid_request", "Choose to email the link or create one to copy.");
  const { id } = await route.params;
  if (context.demo) return ok(parsed.data.action === "send" ? { sentTo: parsed.data.email ?? "client@example.test" } : { url: `${new URL(request.url).origin}/portal/demo` }, { demo: true, persisted: false });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try { return ok(parsed.data.action === "send" ? await sendPortalLink(context, id, parsed.data.email) : await createPortalLink(context, id)); } catch (error) { return failure(error); }
}

/** Turns off the client's portal link. */
export async function DELETE(request: Request, route: RouteContext<"/api/v1/jobs/[id]/portal">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full") return problem(403, "read_only", "Changes require an active workspace.");
  const { id } = await route.params;
  if (context.demo) return ok({ revoked: 1 }, { demo: true, persisted: false });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try { return ok(await revokePortal(context, id)); } catch (error) { return failure(error); }
}
