import {createHash} from "node:crypto";
import type {backgroundJobs} from "@surveynt/db";
import {z} from "zod";
import {decryptCalendarSecret} from "./calendar-oauth";
const summary=z.object({connectionId:z.uuid(),organisationId:z.uuid(),provider:z.enum(["google","microsoft"]),channelId:z.string().min(1).max(2048).nullable(),registrationAttemptId:z.uuid().optional(),replacementChannelId:z.uuid().optional(),phase:z.enum(["ready","dispatched","confirmed"]).optional()});
export type CalendarReviewSummary={jobType:string;attempts:number;leaseToken:string|null;reviewVersion:string;registrationAttemptId:string|null;provider:"google"|"microsoft"|null;channelId:string|null;replacementChannelId:string|null;phase:string};
export function calendarReviewVersion(job:typeof backgroundJobs.$inferSelect){return createHash("sha256").update(JSON.stringify({id:job.id,attempts:job.attempts,leaseToken:job.leaseToken,status:job.status,updatedAt:job.updatedAt.toISOString(),payload:job.payload})).digest("hex");}
/** Only this explicit whitelist may cross the server/client boundary. */
export function calendarReviewSummary(job:typeof backgroundJobs.$inferSelect):CalendarReviewSummary|null{
 if(job.queue!=="calendar_subscription")return null;
 const base={jobType:job.type,attempts:job.attempts,leaseToken:job.leaseToken,reviewVersion:calendarReviewVersion(job)};
 try{
  const snapshot=summary.parse(decryptCalendarSecret(String(job.payload.encryptedCleanup??"")));
  if(snapshot.organisationId!==job.organisationId||snapshot.connectionId!==job.payload.connectionId)throw new Error();
  return {...base,registrationAttemptId:snapshot.registrationAttemptId??null,provider:snapshot.provider,channelId:snapshot.channelId,replacementChannelId:snapshot.replacementChannelId??null,phase:snapshot.phase??"recorded"};
 }catch{return {...base,registrationAttemptId:null,provider:null,channelId:null,replacementChannelId:null,phase:"unavailable"};}
}
