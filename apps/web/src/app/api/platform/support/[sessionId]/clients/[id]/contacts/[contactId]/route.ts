import { PATCH as handlePATCH, DELETE as handleDELETE } from "@/app/api/v1/clients/[id]/contacts/[contactId]/route";
export async function PATCH(request: Request, route: RouteContext<"/api/platform/support/[sessionId]/clients/[id]/contacts/[contactId]">) {
  const { id, contactId } = await route.params;
  return handlePATCH(request, { params: Promise.resolve({ id, contactId }) });
}
export async function DELETE(request: Request, route: RouteContext<"/api/platform/support/[sessionId]/clients/[id]/contacts/[contactId]">) {
  const { id, contactId } = await route.params;
  return handleDELETE(request, { params: Promise.resolve({ id, contactId }) });
}
