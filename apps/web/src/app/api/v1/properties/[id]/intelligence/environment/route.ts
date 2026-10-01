import { intelligenceResponse } from "../view";

export const runtime = "nodejs";

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence/environment">) {
  return intelligenceResponse(request, (await route.params).id, ["flood", "geology", "environment", "mining", "land"]);
}
