import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { problem } from "@/lib/api";
import { createCalendarAuthorization } from "@/lib/calendar-oauth";

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context?.internalUserId) return problem(401, "unauthorised", "Authentication is required.");
  if (!canWriteWorkspace(context) || !canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot connect a calendar.");
  const parsed = z.enum(["google", "microsoft"]).safeParse(new URL(request.url).searchParams.get("provider")); if (!parsed.success) return problem(400, "invalid_provider", "Choose Google or Microsoft.");
  try { return Response.redirect(createCalendarAuthorization(parsed.data, { organisationId: context.organisationId, userId: context.internalUserId }, new URL(request.url).origin)); }
  catch (error) { if ((error as Error).message === "CALENDAR_PROVIDER_NOT_CONFIGURED") return problem(503, "not_configured", "That calendar provider is not configured."); throw error; }
}
