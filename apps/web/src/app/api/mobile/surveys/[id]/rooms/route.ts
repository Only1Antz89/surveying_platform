import { mobileOperationId, MobileCaptureOperationError } from "@/lib/mobile-capture-operation";
import { z } from "zod";
import { ok, parseBody, problem } from "@/lib/api";
import { mobileContext } from "@/lib/mobile-access";
import { surveyContextFor } from "@/lib/mobile-capture";
import { roomInput } from "@/lib/floor-plan-model";
import { addRoom, FloorPlanError } from "@/lib/floor-plans";

/** Adds a measured room from site. The companion removes an item from its queue only after this succeeds. */
export async function POST(request: Request, route: RouteContext<"/api/mobile/surveys/[id]/rooms">) {
  const context = await mobileContext(request);
  if (!context) return problem(401, "unauthorised", "An authorised mobile surveyor session is required.");
  const operation = mobileOperationId.safeParse(request.headers.get("x-surveynt-operation-id"));
  if (!operation.success) return problem(422, "operation_id_required", "Update the companion to send a stable capture operation identifier.");
  const parsed = await parseBody(request, roomInput);
  if (!parsed.success) return problem(422, "invalid_room", "Name the room, choose a floor and enter dimensions in metres.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  try { return ok(await addRoom(surveyContextFor(context), id, parsed.data, operation.data)); }
  catch (error) { if (error instanceof MobileCaptureOperationError || error instanceof FloorPlanError) return problem(error.status, error.code, error.message); throw error; }
}
