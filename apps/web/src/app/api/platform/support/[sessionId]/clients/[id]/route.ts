import { GET as handleGET, PATCH as handlePATCH } from "@/app/api/v1/clients/[id]/route";
export async function GET(request: Request, route: RouteContext<"/api/platform/support/[sessionId]/clients/[id]">) {
  const { id } = await route.params;
  return handleGET(request, { params: Promise.resolve({ id }) });
}
export async function PATCH(request: Request, route: RouteContext<"/api/platform/support/[sessionId]/clients/[id]">) {
  const { id } = await route.params;
  return handlePATCH(request, { params: Promise.resolve({ id }) });
}
