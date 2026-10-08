import {and,eq,sql} from "drizzle-orm";
import {backgroundJobs,calendarConnections,type Database} from "@surveynt/db";
import {z} from "zod";
import {calendarEncryptionKeyVersion,decryptCalendarSecret,encryptCalendarSecret} from "./calendar-oauth";
import {cleanupTokensSchema,refreshCleanupTokens,CalendarSubscriptionError} from "./calendar-subscription";
import {createGoogleReplacementChannel} from "./calendar-google-channel";
const schema=z.object({connectionId:z.uuid(),organisationId:z.uuid(),userId:z.uuid(),provider:z.literal("google"),channelId:z.string().min(1),resourceId:z.string().nullable(),tokens:cleanupTokensSchema,expectedCredentials:z.string(),replacementChannelId:z.uuid(),origin:z.string(),phase:z.enum(["ready","dispatched","confirmed"]).default("ready"),confirmed:z.object({channelId:z.uuid(),resourceId:z.string().min(1),expiresAt:z.string().datetime()}).optional()});
export async function processGoogleReplacement(db:Database,job:typeof backgroundJobs.$inferSelect){
 const snapshot=schema.parse(decryptCalendarSecret(String(job.payload.encryptedCleanup??"")));
 if(snapshot.organisationId!==job.organisationId||snapshot.connectionId!==job.payload.connectionId)throw new CalendarSubscriptionError(true);
 async function persist(){
  const saved=await db.update(backgroundJobs).set({payload:{connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret(snapshot)},updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,job.leaseToken!))).returning({id:backgroundJobs.id});
  if(!saved.length)throw new CalendarSubscriptionError(true);
 }
 return db.transaction(async tx=>{
  const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${snapshot.connectionId}`},0)) as acquired`);
  if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)throw new CalendarSubscriptionError(false);
  const [connection]=await tx.select().from(calendarConnections).where(eq(calendarConnections.id,snapshot.connectionId));
  if(!connection||connection.organisationId!==snapshot.organisationId||connection.userId!==snapshot.userId||connection.provider!=="google")throw new CalendarSubscriptionError(true);
  if(snapshot.phase==="dispatched")throw new CalendarSubscriptionError(true);
  if(snapshot.phase==="confirmed"&&connection.status==="active"&&connection.webhookChannelId===snapshot.replacementChannelId)return "completed";
  if(connection.status!=="active"||connection.webhookChannelId!==snapshot.channelId||connection.encryptedCredentials!==snapshot.expectedCredentials){
   if(snapshot.phase==="confirmed")throw new CalendarSubscriptionError(true);
   return "cancelled";
  }
  if(snapshot.phase==="ready"){
   const tokens=await refreshCleanupTokens("google",snapshot.tokens);
   if(tokens!==snapshot.tokens){
    snapshot.tokens=tokens;snapshot.expectedCredentials=encryptCalendarSecret(tokens);
    await db.transaction(async saveTx=>{
     const saved=await saveTx.update(backgroundJobs).set({payload:{connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret(snapshot)},updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,job.leaseToken!))).returning({id:backgroundJobs.id});
     if(!saved.length)throw new CalendarSubscriptionError(true);
     const changed=await saveTx.update(calendarConnections).set({encryptedCredentials:snapshot.expectedCredentials,encryptionKeyVersion:calendarEncryptionKeyVersion(),updatedAt:new Date()}).where(and(eq(calendarConnections.id,connection.id),eq(calendarConnections.status,"active"),eq(calendarConnections.encryptedCredentials,connection.encryptedCredentials))).returning({id:calendarConnections.id});
     if(!changed.length)throw new CalendarSubscriptionError(true);
    });
   }
   snapshot.phase="dispatched";await persist();
   try{
    const confirmed=await createGoogleReplacementChannel(snapshot.connectionId,snapshot.tokens.access_token,snapshot.origin,snapshot.replacementChannelId);
    snapshot.confirmed={...confirmed,expiresAt:confirmed.expiresAt.toISOString()};snapshot.phase="confirmed";await persist();
   }catch(cause){
    if(cause instanceof CalendarSubscriptionError&&!cause.reviewRequired){snapshot.phase="ready";await persist();}
    throw cause;
   }
  }
  const confirmed=snapshot.confirmed;
  if(!confirmed||confirmed.channelId!==snapshot.replacementChannelId||new Date(confirmed.expiresAt).getTime()<=Date.now())throw new CalendarSubscriptionError(true);
  const [claim]=await tx.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,job.leaseToken!))).for("update");
  if(!claim)throw new CalendarSubscriptionError(true);
  await tx.update(calendarConnections).set({webhookChannelId:confirmed.channelId,webhookResourceId:confirmed.resourceId,webhookExpiresAt:new Date(confirmed.expiresAt),lastError:null,updatedAt:new Date()}).where(eq(calendarConnections.id,connection.id));
  await tx.insert(backgroundJobs).values({organisationId:snapshot.organisationId,queue:"calendar_subscription",type:"stop_webhook",deduplicationKey:`calendar-stop:${snapshot.connectionId}:${snapshot.channelId}`,payload:{connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret({connectionId:snapshot.connectionId,organisationId:snapshot.organisationId,userId:snapshot.userId,provider:"google",channelId:snapshot.channelId,resourceId:snapshot.resourceId,tokens:snapshot.tokens})}}).onConflictDoNothing();
  return "completed";
 });
}
