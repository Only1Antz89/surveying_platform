import { handlePreinspectionDocuments } from "@/lib/preinspection-document-handler";
export const runtime = "nodejs";
async function handle(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/questionnaire/documents">) {
  return handlePreinspectionDocuments(request, (await route.params).id, true);
}
export const GET = handle;
export const POST = handle;
