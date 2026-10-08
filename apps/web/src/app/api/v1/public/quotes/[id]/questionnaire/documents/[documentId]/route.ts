import { handlePreinspectionDocuments } from "@/lib/preinspection-document-handler";
export const runtime = "nodejs";
export async function GET(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/questionnaire/documents/[documentId]">) {
  const { id, documentId } = await route.params;
  return handlePreinspectionDocuments(request, id, true, documentId);
}
