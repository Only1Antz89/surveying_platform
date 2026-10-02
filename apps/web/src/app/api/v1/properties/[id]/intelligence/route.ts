import { intelligenceResponse } from "./view";

export const runtime = "nodejs";

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence">) {
  return intelligenceResponse(request, (await route.params).id);
}
