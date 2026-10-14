import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { roomInput } from "@/lib/floor-plan-model";
import { addRoom, FloorPlanError, listRooms } from "@/lib/floor-plans";
import { demoRooms } from "@/lib/demo-floor-plan";

export const runtime = "nodejs";

/** Rooms and measurements recorded for one survey. */
export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]/rooms">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const denial = await workspaceApiGuard(request, context) ?? professionalApiGuard(request, context);
  if (denial) return denial;
  const { id } = await route.params;
  if (context.demo) return ok(demoRooms, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  const rooms = await listRooms(context, id);
  return rooms ? ok(rooms) : problem(404, "survey_not_found", "The survey could not be found.");
}

export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/rooms">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const denial = await workspaceApiGuard(request, context) ?? professionalApiGuard(request, context);
  if (denial) return denial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, roomInput);
  if (!parsed.success) return problem(422, "invalid_room", "Name the room, choose a floor and enter dimensions in metres.");
  const { id } = await route.params;
  if (context.demo) return ok({ id: `room-${crypto.randomUUID()}`, ...parsed.data, lengthM: parsed.data.lengthM ?? null, widthM: parsed.data.widthM ?? null, heightM: parsed.data.heightM ?? null, areaOverrideM2: parsed.data.areaOverrideM2 ?? null, notes: parsed.data.notes ?? null, position: 99, version: 1 }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  try { return ok(await addRoom(context, id, parsed.data)); }
  catch (reason) { if (reason instanceof FloorPlanError) return problem(reason.status, reason.code, reason.message); throw reason; }
}
