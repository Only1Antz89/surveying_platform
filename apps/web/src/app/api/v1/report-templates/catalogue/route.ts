import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ricsCatalogueStatus } from "@/lib/rics-template-catalogue";
export const runtime="nodejs";
export async function GET(request:Request) {
  const context=await apiContext(request);
  if(!context)return problem(401,"unauthorised","Sign in to your company.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  return ok({templates:await ricsCatalogueStatus()});
}
