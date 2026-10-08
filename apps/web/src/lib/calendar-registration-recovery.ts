import {and,eq,sql} from "drizzle-orm";
import {backgroundJobs,calendarConnections,type Database} from "@surveynt/db";
import {z} from "zod";
import {calendarEncryptionKeyVersion,decryptCalendarSecret,encryptCalendarSecret} from "./calendar-oauth";
import {CalendarSubscriptionError} from "./calendar-subscription";
const snapshotSchema=z.object({connectionId:z.uuid(),organisationId:z.uuid(),userId:z.uuid(),provider:z.enum(["google","microsoft"]),providerAccountId:z.string().min(1),registrationAttemptId:z.uuid().optional(),channelId:z.string().min(1).max(2048),expectedCredentials:z.string(),tokens:z.record(z.string(),z.unknown()),phase:z.literal("confirmed"),confirmed:z.object({channelId:z.string().min(1).max(2048),resourceId:z.string().max(2048).nullable(),expiresAt:z.string().datetime().nullable()})});
/** Settles a recorded provider response. Never issues a creation request. */
export async function recoverConfirmedCalendarRegistration(db:Database,job:typeof backgroundJobs.$inferSelect){
 let snapshot:z.infer<typeof snapshotSchema>;
 try{snapshot=snapshotSchema.parse(decryptCalendarSecret(String(job.payload.encryptedCleanup??"")));}catch{throw new CalendarSubscriptionError(true);}
 if(snapshot.organisationId!==job.organisationId||snapshot.connectionId!==job.payload.connectionId||snapshot.channelId!==snapshot.confirmed.channelId)throw new CalendarSubscriptionError(true);
 return db.transaction(async tx=>{
  const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${snapshot.connectionId}`},0)) as acquired`);
  if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)throw new CalendarSubscriptionError(false);
  const [claim]=await tx.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,job.leaseToken!))).for("update");
  if(!claim)throw new CalendarSubscriptionError(true);
  const [connection]=await tx.select().from(calendarConnections).where(eq(calendarConnections.id,snapshot.connectionId)).for("update");
  if(!connection||connection.organisationId!==snapshot.organisationId||connection.userId!==snapshot.userId||connection.provider!==snapshot.provider||connection.providerAccountId!==snapshot.providerAccountId)throw new CalendarSubscriptionError(true);
  if(connection.status==="active"&&connection.webhookChannelId===snapshot.channelId)return "completed";
  const expiresAt=snapshot.confirmed.expiresAt?new Date(snapshot.confirmed.expiresAt):null;
  if(connection.status==="active"&&connection.encryptedCredentials===snapshot.expectedCredentials&&!connection.webhookChannelId&&(!expiresAt||expiresAt.getTime()>Date.now())){
   await tx.update(calendarConnections).set({encryptedCredentials:encryptCalendarSecret(snapshot.tokens),encryptionKeyVersion:calendarEncryptionKeyVersion(),webhookAttemptId:snapshot.provider==="microsoft"?snapshot.registrationAttemptId??null:null,webhookChannelId:snapshot.channelId,webhookResourceId:snapshot.confirmed.resourceId,webhookExpiresAt:expiresAt,lastError:null,updatedAt:new Date()}).where(eq(calendarConnections.id,connection.id));
  }else{
   await tx.insert(backgroundJobs).values({organisationId:snapshot.organisationId,queue:"calendar_subscription",type:"stop_webhook",deduplicationKey:`calendar-stop:${snapshot.connectionId}:${snapshot.channelId}`,payload:{connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret({connectionId:snapshot.connectionId,organisationId:snapshot.organisationId,userId:snapshot.userId,provider:snapshot.provider,channelId:snapshot.channelId,resourceId:snapshot.confirmed.resourceId,tokens:snapshot.tokens})}}).onConflictDoNothing();
  }
  return "completed";
 });
}
