import { z } from "zod";
import { apiContext } from "@/lib/access";
import { problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ricsReportPdf, RicsOutputError } from "@/lib/rics-report-output";
export const runtime="nodejs";

/** Always a watermarked review copy. Formal issue remains behind the existing review gate. */
export async function GET(request:Request,route:RouteContext<"/api/v1/surveys/[id]/report/pdf">) {
  const context=await apiContext(request);
  if(!context)return problem(401,"unauthorised","Sign in to your company.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(context.demo)return problem(409,"rics_output_unavailable","The demo uses local answers. Centrally supplied RICS output requires a configured live company.");
  const {id}=await route.params;if(!z.uuid().safeParse(id).success)return problem(404,"survey_not_found","The survey could not be found.");
  try {
    const output=await ricsReportPdf(context,id,{final:false});
    return new Response(new Uint8Array(output.bytes),{headers:{"content-type":"application/pdf","content-disposition":`attachment; filename="${output.filename}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
  }catch(error){
    if(error instanceof RicsOutputError)return problem(error.status,error.code,error.message);
    throw error;
  }
}
