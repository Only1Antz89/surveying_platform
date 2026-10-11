import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDatabase, organisationOperationalSettings, reportVersions, withTenant } from "@surveynt/db";
import { type ComposedReport } from "@surveynt/assistant";
import { apiContext } from "@/lib/access";
import { problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { currentReportInput } from "@/lib/reports";
import { readSurveyMedia } from "@/lib/surveys";
import { activeReportTemplates } from "@/lib/report-template-settings";
import { centralRicsTemplate } from "@/lib/rics-template-catalogue";
import { PdfOutputError, renderLicensedReportPdf, type OutputPhoto } from "@/lib/licensed-report-pdf";
export const runtime="nodejs";

/** Always a watermarked review copy. Formal issue remains behind the existing review gate. */
export async function GET(request:Request,route:RouteContext<"/api/v1/surveys/[id]/report/pdf">) {
  const context=await apiContext(request);
  if(!context)return problem(401,"unauthorised","Sign in to your company.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(context.demo)return problem(409,"rics_output_unavailable","The demo uses local answers. Centrally supplied RICS output requires a configured live company.");
  const {id}=await route.params;if(!z.uuid().safeParse(id).success)return problem(404,"survey_not_found","The survey could not be found.");
  const snapshot=await withTenant(createDatabase(),context.organisationId,async tx=>{
    const current=await currentReportInput(tx,context,id);if(!current)return null;
    const [version]=await tx.select().from(reportVersions).where(and(eq(reportVersions.surveyId,id),eq(reportVersions.organisationId,context.organisationId))).orderBy(desc(reportVersions.versionNumber)).limit(1);
    const [settings]=await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).limit(1);
    return {...current,version,entitled:activeReportTemplates(settings?.reportTemplateSettings??null).some(row=>row.templateKey===current.pack.template.key && row.templateVersion===current.pack.template.version)};
  });
  if(!snapshot)return problem(404,"survey_not_found","The survey could not be found.");
  if(!snapshot.entitled)return problem(409,"licence_configuration_required","An active company licence for this pinned template is required in Admin settings.");
  if(!snapshot.version)return problem(409,"report_required","Compose a report version first.");
  if(snapshot.version.content.retentionRemoved)return problem(410,"report_content_removed","This report was removed after retention review.");
  if(snapshot.version.inputFingerprint!==snapshot.fingerprint)return problem(409,"out_of_date","Compose a new version from the current survey answers first.");
  try {
    const asset=await centralRicsTemplate(snapshot.pack.template);
    if(!asset)return problem(409,"rics_output_unavailable","Surveyant’s authorised central RICS template has not yet been provisioned for this version.");
    const photos:OutputPhoto[]=[];
    const mediaIds=new Set(snapshot.pack.evidence.filter(link=>link.evidenceType==="media").map(link=>link.evidenceId));
    let totalBytes=0;
    for(const mediaId of mediaIds){
      if(!snapshot.pack.media.some(media=>media.id===mediaId))throw new PdfOutputError("A linked photograph is missing from this survey.");
      const loaded=await readSurveyMedia(context,mediaId);
      if(!loaded || "removed" in loaded)throw new PdfOutputError("A linked photograph is unavailable; the PDF was not exported.");
      if(loaded.media.kind==="video")throw new PdfOutputError("Linked video requires a published customer media supplement. This review PDF cannot include or silently omit it yet.");
      if(loaded.media.kind!=="photo")continue;
      const bytes=new Uint8Array(await new Response(loaded.object.stream).arrayBuffer());totalBytes+=bytes.length;
      if(totalBytes>50*1024*1024)throw new PdfOutputError("Photographs exceed the 50 MB review export limit.");
      photos.push({id:mediaId,label:loaded.media.originalFilename??"Survey photograph",bytes,contentType:loaded.media.contentType});
    }
    const bytes=await renderLicensedReportPdf({bytes:asset.bytes,definition:asset.definition,template:snapshot.pack.template,report:snapshot.version.content as unknown as ComposedReport,answers:snapshot.pack.values,photos,draft:true});
    return new Response(new Uint8Array(bytes),{headers:{"content-type":"application/pdf","content-disposition":`attachment; filename="survey-review-v${snapshot.version.versionNumber}.pdf"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
  }catch(error){
    if(error instanceof PdfOutputError)return problem(422,"pdf_output_failed",error.message);
    return problem(503,"rics_output_unavailable","The central RICS output is unavailable or failed verification. Contact Surveyant support.");
  }
}
