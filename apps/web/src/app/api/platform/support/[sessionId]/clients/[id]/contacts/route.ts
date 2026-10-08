import { POST as handlePOST } from "@/app/api/v1/clients/[id]/contacts/route";
export async function POST(request: Request, route: RouteContext<"/api/platform/support/[sessionId]/clients/[id]/contacts">) {
  const { id } = await route.params;
  return handlePOST(request, { params: Promise.resolve({ id }) });
}
