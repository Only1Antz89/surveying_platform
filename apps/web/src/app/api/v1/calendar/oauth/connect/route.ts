import {workspaceRoute,workspaceModes,type WorkspaceMode} from "@/lib/workspace-mode";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { problem } from "@/lib/api";
import { createCalendarAuthorization } from "@/lib/calendar-oauth";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context?.internalUserId) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(403, "forbidden", "This workspace cannot create calendar connections.");
  if(await isDemoOrganisation(context.organisationId))return problem(409,"demo_isolated","This practice uses simulated calendar connections. No live OAuth connection can be created.");
  const parsed = z.enum(["google", "microsoft"]).safeParse(new URL(request.url).searchParams.get("provider")); if (!parsed.success) return problem(400, "invalid_provider", "Choose Google or Microsoft.");
  const requested=workspaceRoute(new URL(request.url).pathname).requested??request.headers.get("x-surveynt-workspace-mode");
  try { return Response.redirect(createCalendarAuthorization(parsed.data, { organisationId: context.organisationId, userId: context.internalUserId,...(workspaceModes.includes(requested as WorkspaceMode)?{workspaceMode:requested as WorkspaceMode}:{}) }, new URL(request.url).origin)); }
  catch (error) { if ((error as Error).message === "CALENDAR_PROVIDER_NOT_CONFIGURED") return problem(503, "not_configured", "That calendar provider is not configured."); throw error; }
}
