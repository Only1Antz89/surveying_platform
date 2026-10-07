import { createHash } from "node:crypto";
import { z } from "zod";
import { and,desc,eq,inArray,isNull } from "drizzle-orm";
import { auditEvents,createDatabase,customerQuotes,jobs,organisations,reportApprovals,reportDeliveries,reportVersions,surveys,withTenant } from "@surveynt/db";
import { readPublicQuote } from "@/lib/firm-operations";
import { currentReportInput } from "@/lib/reports";
import { ok,parseBody,problem } from "@/lib/api";
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

const receipt=z.object({reportVersionId:z.uuid(),confirmed:z.literal(true)}).strict();
/** Explicit receipt confirmation, not an inferred delivery from preparing an HTTP response. */
export async function POST(request:Request,route:RouteContext<"/api/v1/public/quotes/[id]/reports">){
  const token=request.headers.get("x-quote-token")??"";
  const found=await readPublicQuote((await route.params).id,token);
  if(!found||!found.row.jobId)return problem(404,"not_found","Your customer link could not be verified.");
  const parsed=await parseBody(request,receipt);
  if(!parsed.success)return problem(400,"invalid_request","Confirm receipt of the current issued report.");
  return withTenant(createDatabase(),found.row.organisationId,async tx=>{
    // Serialize acknowledgements and token revocation against this customer link.
    const [organisation]=await tx.select({id:organisations.id}).from(organisations).where(and(eq(organisations.id,found.row.organisationId),eq(organisations.status,"active"))).for("share");
    if(!organisation)return problem(404,"not_found","Your customer link could not be verified.");
    const [quote]=await tx.select().from(customerQuotes).where(and(eq(customerQuotes.id,found.row.id),eq(customerQuotes.organisationId,found.row.organisationId),eq(customerQuotes.accessTokenHash,createHash("sha256").update(token).digest("hex")),isNull(customerQuotes.tokenRevokedAt))).for("update");
    if(!quote?.jobId)return problem(404,"not_found","Your customer link could not be verified.");
    const [job]=await tx.select().from(jobs).where(and(eq(jobs.id,quote.jobId),eq(jobs.organisationId,quote.organisationId),inArray(jobs.stage,["issued","paid"]))).for("update");
    if(!job)return problem(409,"report_unavailable","The report is no longer available for receipt confirmation.");
    const [survey]=await tx.select().from(surveys).where(and(eq(surveys.jobId,job.id),eq(surveys.organisationId,job.organisationId),eq(surveys.status,"approved"))).limit(1);
    if(!survey)return problem(409,"report_unavailable","The report is no longer available for receipt confirmation.");
    const [record]=await tx.select({report:reportVersions}).from(reportVersions).innerJoin(reportApprovals,and(eq(reportApprovals.reportVersionId,reportVersions.id),eq(reportApprovals.organisationId,job.organisationId))).where(and(eq(reportVersions.surveyId,survey.id),eq(reportVersions.organisationId,job.organisationId))).orderBy(desc(reportVersions.versionNumber)).limit(1);
    if(!record||record.report.id!==parsed.data.reportVersionId)return problem(409,"report_changed","Reload and confirm receipt of the current issued report.");
    const current=await currentReportInput(tx,{organisationId:job.organisationId},survey.id);
    if(current?.fingerprint!==record.report.inputFingerprint)return problem(409,"report_changed","The report needs a new professional review.");
    // Link identity avoids duplicating personal email data in the retention register.
    const recipient=`customer-quote:${quote.id}`;
    const [existing]=await tx.select().from(reportDeliveries).where(and(eq(reportDeliveries.organisationId,job.organisationId),eq(reportDeliveries.jobId,job.id),eq(reportDeliveries.reportVersionId,record.report.id),eq(reportDeliveries.recipient,recipient),eq(reportDeliveries.deliveryMethod,"customer_acknowledgement"))).limit(1);
    if(existing)return ok({id:existing.id,deliveredAt:existing.deliveredAt,confirmed:true});
    const [delivery]=await tx.insert(reportDeliveries).values({organisationId:job.organisationId,jobId:job.id,reportVersionId:record.report.id,recipient,deliveryMethod:"customer_acknowledgement",status:"delivered",deliveredAt:new Date()}).returning();
    await tx.insert(auditEvents).values({organisationId:job.organisationId,action:"customer.report_receipt_confirmed",resourceType:"report_delivery",resourceId:delivery.id,metadata:{quoteId:quote.id,reportVersionId:record.report.id,confirmed:true}});
    return ok({id:delivery.id,deliveredAt:delivery.deliveredAt,confirmed:true});
  });
}
