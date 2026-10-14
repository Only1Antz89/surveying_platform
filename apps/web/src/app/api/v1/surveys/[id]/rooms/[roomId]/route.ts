import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { roomInput } from "@/lib/floor-plan-model";
import { FloorPlanError, removeRoom, updateRoom } from "@/lib/floor-plans";

export const runtime = "nodejs";

async function guarded(request: Request) {
  const context = await apiContext(request);
  if (!context) return { response: problem(401, "unauthorised", "Authentication and an active organisation are required.") };
  const denial = await workspaceApiGuard(request, context) ?? professionalApiGuard(request, context);
  if (denial) return { response: denial };
  if (!canWriteWorkspace(context)) return { response: problem(402, "workspace_read_only", "Restore billing before changing workspace records.") };
  return { context };
}

export async function PATCH(request: Request, route: RouteContext<"/api/v1/surveys/[id]/rooms/[roomId]">) {
  const { context, response } = await guarded(request);
  if (!context) return response;
  const parsed = await parseBody(request, roomInput.extend({ version: z.number().int().positive() }));
  if (!parsed.success) return problem(422, "invalid_room", "Name the room, choose a floor and enter dimensions in metres.");
  const { id, roomId } = await route.params;
  if (context.demo) return ok({ id: roomId, ...parsed.data, version: parsed.data.version + 1 }, { demo: true, persisted: false });
  const invalid = invalidId(context, id, roomId);
  if (invalid) return invalid;
  const { version, ...input } = parsed.data;
  try { return ok(await updateRoom(context, id, roomId, version, input)); }
  catch (reason) { if (reason instanceof FloorPlanError) return problem(reason.status, reason.code, reason.message); throw reason; }
}

export async function DELETE(request: Request, route: RouteContext<"/api/v1/surveys/[id]/rooms/[roomId]">) {
  const { context, response } = await guarded(request);
  if (!context) return response;
  const { id, roomId } = await route.params;
  if (context.demo) return ok({ id: roomId }, { demo: true, persisted: false });
  const invalid = invalidId(context, id, roomId);
  if (invalid) return invalid;
  try { return ok(await removeRoom(context, id, roomId)); }
  catch (reason) { if (reason instanceof FloorPlanError) return problem(reason.status, reason.code, reason.message); throw reason; }
}
