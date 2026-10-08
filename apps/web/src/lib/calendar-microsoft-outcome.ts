import type {backgroundJobs} from "@surveynt/db";
import {z} from "zod";
import {calendarWebhookToken,decryptCalendarSecret,encryptCalendarSecret} from "./calendar-oauth";
import {calendarOutcomeSchema,CalendarOutcomeError} from "./calendar-provider-outcome";
import {calendarReviewVersion} from "./calendar-review-summary";
import {cleanupTokensSchema,refreshCleanupTokens} from "./calendar-subscription";
import {verifyMicrosoftCalendarSubscription} from "./calendar-microsoft-verification";
const snapshotSchema=z.object({connectionId:z.uuid(),organisationId:z.uuid(),userId:z.uuid(),provider:z.literal("microsoft"),providerAccountId:z.string().min(1),applicationId:z.string().min(1).optional(),registrationAttemptId:z.uuid(),clientState:z.string().min(1),origin:z.string().url(),phase:z.literal("dispatched"),tokens:cleanupTokensSchema.passthrough()}).passthrough();
export async function reviewedMicrosoftRegistration(job:typeof backgroundJobs.$inferSelect,input:z.infer<typeof calendarOutcomeSchema>){
 if(job.queue!=="calendar_subscription"||job.type!=="register_webhook"||job.status!=="failed"||input.outcome!=="registration_confirmed"||calendarReviewVersion(job)!==input.reviewVersion)throw new CalendarOutcomeError("Reload and review the current Microsoft registration attempt.");
 try{
  const snapshot=snapshotSchema.parse(decryptCalendarSecret(String(job.payload.encryptedCleanup??"")));
  if(snapshot.organisationId!==job.organisationId||snapshot.connectionId!==job.payload.connectionId||snapshot.registrationAttemptId!==input.verifiedAttemptId||snapshot.clientState!==calendarWebhookToken(snapshot.connectionId,snapshot.registrationAttemptId))throw new Error();
  const origin=new URL(snapshot.origin);if(origin.protocol!=="https:"||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error();
  const applicationId=snapshot.applicationId??process.env.MICROSOFT_CALENDAR_CLIENT_ID;if(!applicationId)throw new Error();
  const confirmed=await verifyMicrosoftCalendarSubscription(snapshot.tokens.access_token,{subscriptionId:input.verifiedChannelId,providerAccountId:snapshot.providerAccountId,applicationId,notificationUrl:new URL("/api/webhooks/calendar/microsoft",origin).toString(),clientState:snapshot.clientState});
  return {status:"queued",completedAt:null,payload:{connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret({...snapshot,channelId:confirmed.channelId,phase:"confirmed",confirmed:{...confirmed,expiresAt:confirmed.expiresAt.toISOString()}})}};
 }catch{throw new CalendarOutcomeError("The provider could not verify this subscription against the recorded Microsoft attempt. Review credentials and exact provider evidence before retrying.");}
}

/** Refresh is committed separately before any provider verification can fail. */
export async function prepareMicrosoftRegistrationReview(job:typeof backgroundJobs.$inferSelect,input:z.infer<typeof calendarOutcomeSchema>){
 if(job.queue!=="calendar_subscription"||job.type!=="register_webhook"||job.status!=="failed"||input.outcome!=="registration_confirmed"||calendarReviewVersion(job)!==input.reviewVersion)throw new CalendarOutcomeError("Reload and review the current Microsoft registration attempt.");
 try{
  const snapshot=snapshotSchema.parse(decryptCalendarSecret(String(job.payload.encryptedCleanup??"")));
  if(snapshot.organisationId!==job.organisationId||snapshot.connectionId!==job.payload.connectionId||snapshot.registrationAttemptId!==input.verifiedAttemptId||snapshot.clientState!==calendarWebhookToken(snapshot.connectionId,snapshot.registrationAttemptId))throw new Error();
  const tokens=snapshot.tokens;
  // Preserve legacy credentials with unknown lifetimes for the exact provider read.
  if(tokens.obtained_at===undefined||tokens.expires_in===undefined||tokens.obtained_at+tokens.expires_in*1000>Date.now()+60000)return null;
  const refreshed=await refreshCleanupTokens("microsoft",tokens);
  return {connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret({...snapshot,tokens:{...tokens,...refreshed}})};
 }catch{throw new CalendarOutcomeError("The recorded Microsoft credentials could not be refreshed. Review the current registration attempt before retrying.");}
}
