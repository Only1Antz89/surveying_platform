import type {backgroundJobs} from "@surveynt/db";
import {z} from "zod";
import {decryptCalendarSecret,encryptCalendarSecret} from "./calendar-oauth";
import {calendarReviewVersion} from "./calendar-review-summary";
export const calendarOutcomeSchema=z.object({reviewVersion:z.string().regex(/^[a-f0-9]{64}$/),outcome:z.enum(["retry","removed","replacement_confirmed","replacement_not_created","cleanup_identity_verified","registration_confirmed","registration_not_created"]),verifiedAttemptId:z.uuid().optional(),verifiedChannelId:z.string().trim().min(1).max(2048),resourceId:z.string().trim().min(1).max(2048).optional(),expiresAt:z.string().max(64).datetime({offset:true}).optional(),evidence:z.string().trim().min(15).max(2000),confirmed:z.literal(true)}).strict();
const snapshotSchema=z.object({connectionId:z.uuid(),organisationId:z.uuid(),userId:z.uuid(),provider:z.enum(["google","microsoft"]),channelId:z.string().min(1).nullable(),resourceId:z.string().nullable().optional(),registrationAttemptId:z.uuid().optional(),replacementChannelId:z.uuid().optional(),phase:z.enum(["ready","dispatched","confirmed"]).optional(),tokens:z.record(z.string(),z.unknown())}).passthrough();
export class CalendarOutcomeError extends Error{}
export function reviewedCalendarOutcome(job:typeof backgroundJobs.$inferSelect,input:z.infer<typeof calendarOutcomeSchema>){
 const parsed=calendarOutcomeSchema.safeParse(input);
 if(!parsed.success)throw new CalendarOutcomeError("Confirm the current calendar outcome with substantive provider evidence.");
 input=parsed.data;
 if(job.queue!=="calendar_subscription"||job.status!=="failed"||calendarReviewVersion(job)!==input.reviewVersion)throw new CalendarOutcomeError("Reload and review the current calendar attempt.");
 let snapshot:z.infer<typeof snapshotSchema>;
 try{snapshot=snapshotSchema.parse(decryptCalendarSecret(String(job.payload.encryptedCleanup??"")));}catch{throw new CalendarOutcomeError("The encrypted calendar evidence is unavailable. Review its credentials and encryption keys before continuing.");}
 if(snapshot.organisationId!==job.organisationId||snapshot.connectionId!==job.payload.connectionId)throw new CalendarOutcomeError("The calendar attempt binding is invalid.");
 if(input.outcome==="registration_not_created"){
  if(job.type!=="register_webhook"||snapshot.phase!=="dispatched"||!snapshot.registrationAttemptId||input.verifiedAttemptId!==snapshot.registrationAttemptId||input.verifiedChannelId!==(snapshot.channelId??snapshot.registrationAttemptId))throw new CalendarOutcomeError("Verify non-creation for the exact recorded initial registration attempt.");
  return {status:"cancelled",payload:{connectionId:snapshot.connectionId},completedAt:new Date()};
 }
 if(job.type==="register_webhook"&&snapshot.phase==="ready"&&input.outcome==="retry"){
  if(!snapshot.registrationAttemptId||input.verifiedAttemptId!==snapshot.registrationAttemptId||input.verifiedChannelId!==(snapshot.channelId??snapshot.registrationAttemptId))throw new CalendarOutcomeError("Verify the recorded pre-dispatch registration attempt.");
  return {status:"queued",payload:{connectionId:snapshot.connectionId,encryptedCleanup:String(job.payload.encryptedCleanup)},completedAt:null};
 }
 if(job.type==="register_webhook"&&!((snapshot.phase==="confirmed"&&input.outcome==="retry")||(snapshot.provider==="google"&&snapshot.phase==="dispatched"&&input.outcome==="registration_confirmed")))throw new CalendarOutcomeError("Only a recorded confirmed registration can retry adoption. Resolve uncertain provider creation first.");
 const replacement=job.type==="replace_webhook";
 const expectedChannel=replacement?snapshot.replacementChannelId:snapshot.channelId;
 if(input.verifiedChannelId!==expectedChannel)throw new CalendarOutcomeError("Review evidence for the recorded attempt channel.");
 if(input.outcome==="removed"){
  if(job.type!=="stop_webhook")throw new CalendarOutcomeError("Only a cleanup attempt can be settled as removed.");
  return {status:"completed",payload:{connectionId:snapshot.connectionId},completedAt:new Date()};
 }
 if(input.outcome==="cleanup_identity_verified"){
  if(job.type!=="stop_webhook"||snapshot.provider!=="google"||!input.resourceId)throw new CalendarOutcomeError("Verify the recorded Google cleanup channel and resource identity.");
  if(snapshot.resourceId&&snapshot.resourceId!==input.resourceId)throw new CalendarOutcomeError("The supplied resource differs from the recorded cleanup identity.");
  snapshot.resourceId=input.resourceId;
 }else if(input.outcome==="replacement_confirmed"||input.outcome==="registration_confirmed"){
  const expiry=input.expiresAt?new Date(input.expiresAt):null;
  if(!(input.outcome==="replacement_confirmed"?replacement:job.type==="register_webhook")||snapshot.provider!=="google"||snapshot.phase!=="dispatched"||!input.resourceId||!expiry||expiry.getTime()<=Date.now()+60000||expiry.getTime()>Date.now()+8*86400000)throw new CalendarOutcomeError("Confirm the dispatched Google channel's resource and future expiry from provider evidence.");
  snapshot.phase="confirmed";snapshot.confirmed={channelId:expectedChannel,resourceId:input.resourceId,expiresAt:expiry.toISOString()};
 }else if(input.outcome==="replacement_not_created"){
  if(!replacement||snapshot.phase!=="dispatched")throw new CalendarOutcomeError("Only an uncertain creation can be reviewed as not created.");
  snapshot.phase="ready";delete snapshot.confirmed;
 }else if(replacement&&snapshot.phase==="dispatched")throw new CalendarOutcomeError("Resolve the uncertain creation before retrying.");
 if(!["stop_webhook","renew_webhook","replace_webhook","register_webhook"].includes(job.type))throw new CalendarOutcomeError("This calendar job type cannot be retried.");
 return {status:"queued",payload:{connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret(snapshot)},completedAt:null};
}
