import { and,desc,eq,inArray } from "drizzle-orm";
import { auditEvents,createDatabase,jobs,reportApprovals,reportVersions,surveys,withTenant } from "@surveynt/db";
import { readPublicQuote } from "@/lib/firm-operations";
import { currentReportInput } from "@/lib/reports";
import { ok,problem } from "@/lib/api";
export async function GET(request:Request,route:RouteContext<"/api/v1/public/quotes/[id]/reports">){
  const found=await readPublicQuote((await route.params).id,request.headers.get("x-quote-token")??"");if(!found)return problem(404,"not_found","Your customer link could not be verified.");if(!found.row.jobId)return ok([]);
  return withTenant(createDatabase(),found.row.organisationId,async tx=>{
    const [job]=await tx.select().from(jobs).where(and(eq(jobs.id,found.row.jobId!),eq(jobs.organisationId,found.row.organisationId),inArray(jobs.stage,["issued","paid"]))).limit(1);if(!job)return ok([]);
    const [survey]=await tx.select().from(surveys).where(and(eq(surveys.jobId,job.id),eq(surveys.organisationId,job.organisationId),eq(surveys.status,"approved"))).limit(1);if(!survey)return ok([]);
    const [record]=await tx.select({report:reportVersions,approvedAt:reportApprovals.createdAt}).from(reportVersions).innerJoin(reportApprovals,and(eq(reportApprovals.reportVersionId,reportVersions.id),eq(reportApprovals.organisationId,job.organisationId))).where(and(eq(reportVersions.surveyId,survey.id),eq(reportVersions.organisationId,job.organisationId))).orderBy(desc(reportVersions.versionNumber)).limit(1);if(!record)return ok([]);
    const current=await currentReportInput(tx,{organisationId:job.organisationId},survey.id);if(current?.fingerprint!==record.report.inputFingerprint)return ok([]);
    await tx.insert(auditEvents).values({organisationId:job.organisationId,action:"customer.report_viewed",resourceType:"report_version",resourceId:record.report.id,metadata:{quoteId:found.row.id}});
    // Content only: internal trace, drafts, observations and evidence files are not exposed.
    return ok([{id:record.report.id,version:record.report.versionNumber,approvedAt:record.approvedAt,content:record.report.content}]);
  });
}
