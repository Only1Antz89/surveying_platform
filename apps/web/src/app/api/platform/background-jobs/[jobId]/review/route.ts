import { z } from "zod";
import { and,eq } from "drizzle-orm";
import { auditEvents,backgroundJobs,communicationDeliveries,createDatabase } from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { ok,parseBody,problem } from "@/lib/api";
const schema=z.object({expectedAttempts:z.number().int().nonnegative(),expectedLeaseToken:z.uuid().nullable(),outcome:z.enum(["accepted","not_accepted"]),providerMessageId:z.string().trim().min(1).max(200).optional(),evidence:z.string().trim().min(15).max(2000),confirmed:z.literal(true)}).refine(value=>value.outcome!=="accepted"||Boolean(value.providerMessageId),"Provider acceptance requires a message identifier.");
export async function POST(request:Request,route:RouteContext<"/api/platform/background-jobs/[jobId]/review">){
  const operator=await platformApiContext();
  if(!operator)return problem(401,"unauthorised","Platform staff authentication is required.");
  if(!["super_admin","support"].includes(operator.role))return problem(403,"forbidden","Your platform role cannot verify delivery evidence.");
  const {jobId}=await route.params;
  if(!z.uuid().safeParse(jobId).success)return problem(404,"job_not_found","Email job not found.");
  const parsed=await parseBody(request,schema);
  if(!parsed.success)return problem(400,"invalid_request","Review the provider outcome, message identifier and evidence before confirming.");
  if(operator.demo)return ok({id:jobId},{demo:true,persisted:false});
  return createDatabase(process.env.DATABASE_ADMIN_URL).transaction(async tx=>{
    const [job]=await tx.select().from(backgroundJobs).where(eq(backgroundJobs.id,jobId)).for("update").limit(1);
    if(!job||job.queue!=="email")return problem(404,"job_not_found","Email job not found.");
    if(job.status!=="delivery_unknown"||job.attempts!==parsed.data.expectedAttempts||job.leaseToken!==parsed.data.expectedLeaseToken)return problem(409,"job_changed","Reload and review the current delivery attempt.");
    const accepted=parsed.data.outcome==="accepted",now=new Date();
    await tx.update(backgroundJobs).set({status:accepted?"completed":"queued",providerMessageId:accepted?parsed.data.providerMessageId!:null,completedAt:accepted?now:null,failedAt:null,error:null,lockedUntil:null,leaseToken:null,attempts:accepted?job.attempts:0,availableAt:now,updatedAt:now}).where(eq(backgroundJobs.id,jobId));
    if(typeof job.payload.deliveryId==="string"&&z.uuid().safeParse(job.payload.deliveryId).success&&job.organisationId)await tx.update(communicationDeliveries).set({status:accepted?"sent":"queued",providerMessageId:accepted?parsed.data.providerMessageId!:null,sentAt:accepted?now:null,lastError:null,updatedAt:now}).where(and(eq(communicationDeliveries.id,job.payload.deliveryId),eq(communicationDeliveries.organisationId,job.organisationId)));
    await tx.insert(auditEvents).values({organisationId:job.organisationId,platformStaffId:operator.platformStaffId,action:"notification.email_provider_reviewed",resourceType:"background_job",resourceId:job.id,metadata:{outcome:parsed.data.outcome,evidence:parsed.data.evidence,providerMessageId:parsed.data.providerMessageId??null,attemptId:job.leaseToken,attempts:job.attempts}});
    return ok({id:job.id,status:accepted?"completed":"queued"},{reviewed:true});
  });
}
