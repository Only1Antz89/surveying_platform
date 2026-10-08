import {prepareMicrosoftRegistrationReview,reviewedMicrosoftRegistration} from "@/lib/calendar-microsoft-outcome";
import {calendarReviewSummary,calendarReviewVersion} from "@/lib/calendar-review-summary";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {auditEvents,backgroundJobs,createDatabase} from "@surveynt/db";
import {platformApiContext} from "@/lib/access";
import {ok,parseBody,problem} from "@/lib/api";
import {calendarOutcomeSchema,CalendarOutcomeError,reviewedCalendarOutcome} from "@/lib/calendar-provider-outcome";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(request:Request,route:RouteContext<"/api/platform/background-jobs/[jobId]/calendar-review">){
 const operator=await platformApiContext();
 if(!operator)return problem(401,"unauthorised","Platform staff authentication is required.");
 if(!["super_admin","support"].includes(operator.role))return problem(403,"forbidden","Your platform role cannot review calendar provider evidence.");
 const {jobId}=await route.params;
 if(!z.uuid().safeParse(jobId).success)return problem(404,"job_not_found","Calendar job not found.");
 const parsed=await parseBody(request,calendarOutcomeSchema);
 if(!parsed.success)return problem(400,"invalid_request","Confirm the recorded channel, provider outcome and evidence.");
 if(operator.demo)return ok({id:jobId},{demo:true,persisted:false});
 const db=createDatabase(process.env.DATABASE_ADMIN_URL);
 let reviewInput=parsed.data;
 if(parsed.data.outcome==="registration_confirmed"){
  const prepared=await db.transaction(async tx=>{
   const [job]=await tx.select().from(backgroundJobs).where(eq(backgroundJobs.id,jobId)).for("update");
   if(!job||calendarReviewSummary(job)?.provider!=="microsoft")return null;
   try{
    const payload=await prepareMicrosoftRegistrationReview(job,parsed.data);
    if(!payload)return null;
    const [saved]=await tx.update(backgroundJobs).set({payload,updatedAt:new Date()}).where(eq(backgroundJobs.id,job.id)).returning();
    await tx.insert(auditEvents).values({organisationId:job.organisationId,platformStaffId:operator.platformStaffId,action:"calendar.review_credentials_refreshed",resourceType:"background_job",resourceId:job.id,metadata:{registrationAttemptId:parsed.data.verifiedAttemptId,reviewVersion:parsed.data.reviewVersion}});
    return {version:calendarReviewVersion(saved)};
   }catch(error){return {error:error instanceof CalendarOutcomeError?error.message:"Reload and review this calendar attempt."};}
  });
  if(prepared&&"error" in prepared)return problem(409,"review_changed",prepared.error??"Reload and review this calendar attempt.");
  if(prepared&&"version" in prepared)reviewInput={...parsed.data,reviewVersion:prepared.version};
 }
 return db.transaction(async tx=>{
  const [job]=await tx.select().from(backgroundJobs).where(eq(backgroundJobs.id,jobId)).for("update");
  if(!job||job.queue!=="calendar_subscription")return problem(404,"job_not_found","Calendar job not found.");
  let outcome;
  try{outcome=job.type==="register_webhook"&&parsed.data.outcome==="registration_confirmed"&&calendarReviewSummary(job)?.provider==="microsoft"?await reviewedMicrosoftRegistration(job,reviewInput):reviewedCalendarOutcome(job,reviewInput);}catch(error){return problem(409,"review_changed",error instanceof CalendarOutcomeError?error.message:"Reload and review this calendar attempt.");}
  const now=new Date();
  await tx.update(backgroundJobs).set({...outcome,attempts:outcome.status==="queued"?0:job.attempts,availableAt:now,failedAt:null,error:null,leaseToken:null,lockedUntil:null,updatedAt:now}).where(eq(backgroundJobs.id,job.id));
  await tx.insert(auditEvents).values({organisationId:job.organisationId,platformStaffId:operator.platformStaffId,action:"calendar.provider_outcome_reviewed",resourceType:"background_job",resourceId:job.id,metadata:{outcome:parsed.data.outcome,registrationAttemptId:parsed.data.verifiedAttemptId??null,channelId:parsed.data.verifiedChannelId,resourceId:parsed.data.resourceId??null,expiresAt:parsed.data.expiresAt??null,evidence:parsed.data.evidence,reviewVersion:parsed.data.reviewVersion,attempts:job.attempts}});
  return ok({id:job.id,status:outcome.status},{reviewed:true});
 });
}
