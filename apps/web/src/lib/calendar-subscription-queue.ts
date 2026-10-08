import {processReadyCalendarRegistration} from "./calendar-registration-ready";
import {recoverConfirmedCalendarRegistration} from "./calendar-registration-recovery";
import {processGoogleReplacement} from "./calendar-google-replacement";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull,isNull,lte, or, sql } from "drizzle-orm";
import { auditEvents,backgroundJobs, calendarConnections, createDatabase } from "@surveynt/db";
import { z } from "zod";
import { calendarEncryptionKeyVersion,decryptCalendarSecret,encryptCalendarSecret } from "./calendar-oauth";
import { cleanupTokensSchema,refreshCleanupTokens,CalendarSubscriptionError,renewMicrosoftSubscription, stopCalendarSubscription } from "./calendar-subscription";

const snapshotSchema=z.object({connectionId:z.uuid(),organisationId:z.uuid(),userId:z.uuid(),provider:z.enum(["google","microsoft"]),channelId:z.string().min(1).max(2048),resourceId:z.string().max(2048).nullable(),tokens:cleanupTokensSchema,expectedCredentials:z.string().optional()});
export async function processCalendarSubscriptionQueue(limit=1,deadline=Date.now()+50000){
 if(!process.env.DATABASE_ADMIN_URL)return {configured:false,processed:0};
 const db=createDatabase(process.env.DATABASE_ADMIN_URL);let processed=0;
 const batchLimit=Number.isFinite(limit)?Math.max(0,Math.min(Math.floor(limit),10)):0;
 for(let index=0;index<batchLimit&&Date.now()+35000<=deadline;index++){
  const now=new Date();
  const claimed=await db.transaction(async tx=>{
   const [job]=await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue,"calendar_subscription"),or(eq(backgroundJobs.type,"stop_webhook"),eq(backgroundJobs.type,"renew_webhook"),eq(backgroundJobs.type,"replace_webhook"),eq(backgroundJobs.type,"register_webhook")),or(and(eq(backgroundJobs.status,"queued"),lte(backgroundJobs.availableAt,now)),and(eq(backgroundJobs.status,"processing"),lte(backgroundJobs.lockedUntil,now))))).orderBy(asc(backgroundJobs.availableAt)).limit(1).for("update",{skipLocked:true});
   if(!job)return null;
   const leaseToken=randomUUID();
   await tx.update(backgroundJobs).set({status:"processing",leaseToken,lockedUntil:new Date(Date.now()+300000),attempts:job.attempts+1,updatedAt:now}).where(eq(backgroundJobs.id,job.id));
   return {...job,leaseToken,attempts:job.attempts+1};
  });
  if(!claimed)break;
  let status="completed",error:string|null=null;
  try{
   if(claimed.attempts>5)throw new CalendarSubscriptionError(true);
   if(claimed.type==="register_webhook"){
    const recorded=decryptCalendarSecret<{phase?:string}>(String(claimed.payload.encryptedCleanup??""));
    status=recorded.phase==="ready"?await processReadyCalendarRegistration(db,claimed):await recoverConfirmedCalendarRegistration(db,claimed);
   }
   else if(claimed.type==="replace_webhook")status=await processGoogleReplacement(db,claimed);
   else{
   const snapshot=snapshotSchema.parse(decryptCalendarSecret<unknown>(String(claimed.payload.encryptedCleanup??"")));
   if(snapshot.organisationId!==claimed.organisationId||snapshot.connectionId!==claimed.payload.connectionId)throw new CalendarSubscriptionError(true);
   await db.transaction(async tx=>{
    const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${snapshot.connectionId}`},0)) as acquired`);
    if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)throw new CalendarSubscriptionError(false);
    const [connection]=await tx.select().from(calendarConnections).where(eq(calendarConnections.id,snapshot.connectionId));
    if(!connection||connection.organisationId!==snapshot.organisationId||connection.userId!==snapshot.userId)throw new CalendarSubscriptionError(true);
    const renewal=claimed.type==="renew_webhook";
    if(renewal?(connection.status!=="active"||connection.webhookChannelId!==snapshot.channelId||connection.encryptedCredentials!==snapshot.expectedCredentials):(connection.status==="active"&&connection.webhookChannelId===snapshot.channelId)){status="cancelled";return;}
    if(renewal&&snapshot.provider!=="microsoft")throw new CalendarSubscriptionError(true);
    if(connection.provider!==snapshot.provider||(snapshot.provider==="google"&&!snapshot.resourceId))throw new CalendarSubscriptionError(true);
   const tokens=await refreshCleanupTokens(snapshot.provider,snapshot.tokens);
   if(tokens!==snapshot.tokens){
    snapshot.tokens=tokens;
    const refreshedCredentials=renewal?encryptCalendarSecret(tokens):null;
    if(refreshedCredentials)snapshot.expectedCredentials=refreshedCredentials;
    await db.transaction(async saveTx=>{
     if(refreshedCredentials){
      const changed=await saveTx.update(calendarConnections).set({encryptedCredentials:refreshedCredentials,encryptionKeyVersion:calendarEncryptionKeyVersion(),updatedAt:new Date()}).where(and(eq(calendarConnections.id,connection.id),eq(calendarConnections.status,"active"),eq(calendarConnections.encryptedCredentials,connection.encryptedCredentials))).returning({id:calendarConnections.id});
      if(!changed.length)throw new CalendarSubscriptionError(true);
     }
     const saved=await saveTx.update(backgroundJobs).set({payload:{connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret(snapshot)},updatedAt:new Date()}).where(and(eq(backgroundJobs.id,claimed.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,claimed.leaseToken))).returning({id:backgroundJobs.id});
     if(!saved.length)throw new CalendarSubscriptionError(true);
    });
   }
    if(renewal){
     const confirmed=await renewMicrosoftSubscription(snapshot.tokens.access_token,snapshot.channelId);
     const [currentClaim]=await tx.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.id,claimed.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,claimed.leaseToken))).for("update");
     if(!currentClaim)throw new CalendarSubscriptionError(true);
     await tx.update(calendarConnections).set({webhookExpiresAt:confirmed.expiresAt,lastError:null,updatedAt:new Date()}).where(and(eq(calendarConnections.id,connection.id),eq(calendarConnections.status,"active"),eq(calendarConnections.webhookChannelId,snapshot.channelId)));
    }else await stopCalendarSubscription(snapshot.provider,snapshot.tokens.access_token,snapshot.channelId,snapshot.resourceId);
   });
   }
  }catch(cause){
   const retry=cause instanceof CalendarSubscriptionError&&!cause.reviewRequired&&claimed.attempts<5;
   status=retry?"queued":"failed";
   error=retry?"Calendar subscription cleanup will retry.":"Calendar subscription cleanup requires provider review.";
  }
  await db.transaction(async tx=>{
   const saved=await tx.update(backgroundJobs).set({status,error,lockedUntil:null,leaseToken:null,availableAt:new Date(Date.now()+60000),completedAt:status==="completed"||status==="cancelled"?new Date():null,failedAt:status==="failed"?new Date():null,...(status==="completed"||status==="cancelled"?{payload:{connectionId:claimed.payload.connectionId}}:{}),updatedAt:new Date()}).where(and(eq(backgroundJobs.id,claimed.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,claimed.leaseToken))).returning({id:backgroundJobs.id});
   if(saved.length)await tx.insert(auditEvents).values({organisationId:claimed.organisationId,action:`calendar.subscription_${claimed.type==="register_webhook"?"registration":claimed.type==="stop_webhook"?"cleanup":"renewal"}_${status}`,resourceType:"background_job",resourceId:claimed.id,metadata:{attempt:claimed.attempts}});
  });
  processed++;
 }
 return {configured:true,processed};
}

/** One job per confirmed expiry; a held renewal is not silently duplicated by cron. */
export async function enqueueMicrosoftSubscriptionRenewals(){return enqueueSubscriptionRenewals("microsoft");}
export async function enqueueGoogleSubscriptionReplacements(){return enqueueSubscriptionRenewals("google");}
async function enqueueSubscriptionRenewals(provider:"google"|"microsoft"){
 if(!process.env.DATABASE_ADMIN_URL)return 0;
 const db=createDatabase(process.env.DATABASE_ADMIN_URL);
 const due=await db.select().from(calendarConnections).where(and(eq(calendarConnections.provider,provider),eq(calendarConnections.status,"active"),isNotNull(calendarConnections.webhookChannelId),or(isNull(calendarConnections.webhookExpiresAt),lte(calendarConnections.webhookExpiresAt,new Date(Date.now()+86400000))),sql`not exists (select 1 from background_jobs existing where existing.deduplication_key = ('calendar-renew:' || ${calendarConnections.id}::text || ':' || ${calendarConnections.webhookChannelId} || ':' || coalesce(to_char(${calendarConnections.webhookExpiresAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'unknown')) and existing.status <> 'cancelled')`)).orderBy(asc(calendarConnections.webhookExpiresAt),asc(calendarConnections.id)).limit(100);let queued=0;
 for(const connection of due){
  if(!connection.webhookChannelId)continue;
  let encryptedCleanup:string|null=null;
  try{encryptedCleanup=encryptCalendarSecret({connectionId:connection.id,organisationId:connection.organisationId,userId:connection.userId,provider:connection.provider,channelId:connection.webhookChannelId,resourceId:connection.webhookResourceId,...(provider==="google"?{replacementChannelId:randomUUID(),origin:process.env.APP_URL??"",phase:"ready"}:{}),expectedCredentials:connection.encryptedCredentials,tokens:cleanupTokensSchema.parse(decryptCalendarSecret(connection.encryptedCredentials))});}catch{/* Retain malformed credentials for explicit review. */}
  const inserted=await db.insert(backgroundJobs).values({organisationId:connection.organisationId,queue:"calendar_subscription",type:provider==="google"?"replace_webhook":"renew_webhook",deduplicationKey:`calendar-renew:${connection.id}:${connection.webhookChannelId}:${connection.webhookExpiresAt?.toISOString()??"unknown"}`,payload:{connectionId:connection.id,encryptedCleanup},status:encryptedCleanup?"queued":"failed",error:encryptedCleanup?null:"Calendar renewal credentials require review."}).onConflictDoUpdate({target:backgroundJobs.deduplicationKey,set:{status:encryptedCleanup?"queued":"failed",payload:{connectionId:connection.id,encryptedCleanup},attempts:0,availableAt:new Date(),completedAt:null,failedAt:null,leaseToken:null,lockedUntil:null,error:encryptedCleanup?null:"Calendar renewal credentials require review.",updatedAt:new Date()},setWhere:eq(backgroundJobs.status,"cancelled")}).returning({id:backgroundJobs.id});queued+=inserted.length;
 }
 return queued;
}
