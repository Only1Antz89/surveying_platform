import { handlePreinspectionDocuments } from "@/lib/preinspection-document-handler";
export const runtime = "nodejs";
async function handle(request: Request, route: RouteContext<"/api/v1/jobs/[id]/questionnaire/documents">) {
  return handlePreinspectionDocuments(request, (await route.params).id, false);
}
export const GET = handle;
export const POST = handle;
