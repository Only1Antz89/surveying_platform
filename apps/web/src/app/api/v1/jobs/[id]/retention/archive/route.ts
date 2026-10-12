import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, createDatabase, jobs, organisationMemberships, surveyFileRemovals, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { readSurveyFileRetention } from "@/lib/survey-file-retention-register";
const input=z.object({reviewVersion:z.string().regex(/^[a-f0-9]{64}$/),archiveUntil:z.iso.date(),reason:z.string().trim().min(10).max(2000)}).strict();
export async function POST(request:Request,route:RouteContext<"/api/v1/jobs/[id]/retention/archive">) {
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to extend file retention.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(!isManagementRole(context.role)||!canWriteWorkspace(context))return problem(403,"forbidden","Practice management access is required.");
  const parsed=await parseBody(request,input);if(!parsed.success)return problem(400,"invalid_request","Choose an archive date and record why the file must be retained longer.");
  if(context.demo)return ok({persisted:false});
  const {id}=await route.params;if(!z.uuid().safeParse(id).success)return problem(404,"not_found","Job not found.");
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    const [member]=await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,context.organisationId),eq(organisationMemberships.userId,context.internalUserId!),eq(organisationMemberships.active,true))).for("share");
    if(!member || member.role!==(context.actorRole??context.role) || !isManagementRole(member.role))return problem(403,"forbidden","Your archive permission changed.");
    const [job]=await tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.organisationId,context.organisationId))).for("update");
    if(!job)return problem(404,"not_found","Job not found.");
    const file=await readSurveyFileRetention(tx,context.organisationId,id);
    if(!file || file.assessment.reviewVersion!==parsed.data.reviewVersion)return problem(409,"retention_changed","Reload the file and review its current retention dates.");
    const [removal]=await tx.select({id:surveyFileRemovals.id}).from(surveyFileRemovals).where(and(eq(surveyFileRemovals.organisationId,context.organisationId),eq(surveyFileRemovals.jobId,id),inArray(surveyFileRemovals.status,["dispatched","verification_required","completed"]))).limit(1);
    if(removal)return problem(409,"removal_started","Removal has started or completed. Archiving cannot recover deleted originals.");
    const until=new Date(`${parsed.data.archiveUntil}T23:59:59.999Z`);
    if(!file.assessment.retentionUntil || until<=file.assessment.retentionUntil || until<=new Date())return problem(422,"invalid_archive_date","The archive date must extend the existing retention period and be in the future.");
    await tx.update(jobs).set({surveyFileArchiveUntil:until,version:job.version+1,updatedAt:new Date()}).where(eq(jobs.id,id));
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:member.userId,action:"job.survey_file_archive_extended",resourceType:"job",resourceId:id,metadata:{previousUntil:file.assessment.retentionUntil.toISOString(),archiveUntil:until.toISOString(),reason:parsed.data.reason,customerAccessExtended:false}});
    return ok({persisted:true,archiveUntil:until.toISOString()});
  });
}
