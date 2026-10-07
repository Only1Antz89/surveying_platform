import {randomUUID} from "node:crypto";
import {and,eq,isNull,sql} from "drizzle-orm";
import {auditEvents,backgroundJobs,calendarConnections,type Database} from "@surveynt/db";
import {calendarWebhookToken,encryptCalendarSecret,registerCalendarWebhook,type CalendarProvider} from "./calendar-oauth";

/** Persist creation and confirmed-response boundaries before adopting any provider channel. */
export async function registerCalendarWebhookAttempt(db:Database,connection:typeof calendarConnections.$inferSelect,tokens:Record<string,unknown>,origin:string){
 if(!["google","microsoft"].includes(connection.provider)||typeof tokens.access_token!=="string"||!tokens.access_token)throw new Error("Calendar registration credentials are invalid.");
 const registrationAttemptId=randomUUID(),leaseToken=randomUUID(),channelId=connection.provider==="google"?randomUUID():null;
 const snapshot={connectionId:connection.id,organisationId:connection.organisationId,userId:connection.userId,provider:connection.provider,providerAccountId:connection.providerAccountId,channelId,registrationAttemptId,applicationId:connection.provider==="microsoft"?process.env.MICROSOFT_CALENDAR_CLIENT_ID:undefined,clientState:connection.provider==="microsoft"&&process.env.CALENDAR_WEBHOOK_SECRET?calendarWebhookToken(connection.id,registrationAttemptId):null,origin,expectedCredentials:connection.encryptedCredentials,tokens,phase:process.env.CALENDAR_WEBHOOK_SECRET?"dispatched":"ready"};
 const job=await db.transaction(async tx=>{
  const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${connection.id}`},0)) as acquired`);
  if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)throw new Error("Calendar registration is already in progress.");
  const [current]=await tx.select().from(calendarConnections).where(and(eq(calendarConnections.id,connection.id),eq(calendarConnections.organisationId,connection.organisationId),eq(calendarConnections.userId,connection.userId),eq(calendarConnections.status,"active"),eq(calendarConnections.encryptedCredentials,connection.encryptedCredentials),isNull(calendarConnections.webhookChannelId))).for("update");
  if(!current)throw new Error("Calendar registration connection changed.");
  const [pending]=await tx.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.organisationId,connection.organisationId),eq(backgroundJobs.queue,"calendar_subscription"),eq(backgroundJobs.type,"register_webhook"),sql`${backgroundJobs.payload}->>'connectionId' = ${connection.id}`,sql`${backgroundJobs.status} in ('queued','processing','failed')`)).limit(1);
  if(pending)throw new Error("Initial calendar registration requires provider review.");
  const [created]=await tx.insert(backgroundJobs).values({organisationId:connection.organisationId,queue:"calendar_subscription",type:"register_webhook",deduplicationKey:`calendar-register:${connection.id}:${registrationAttemptId}`,status:"processing",attempts:1,leaseToken,lockedUntil:new Date(Date.now()+300000),payload:{connectionId:connection.id,encryptedCleanup:encryptCalendarSecret(snapshot)}}).returning();
  return created;
 });
 try{
  const webhook=await registerCalendarWebhook(connection.provider as CalendarProvider,connection.id,String(tokens.access_token),origin,channelId??undefined,registrationAttemptId);
  if(!webhook)throw new Error("Calendar webhook signing is not configured.");
  const confirmed={...snapshot,channelId:webhook.channelId,phase:"confirmed",confirmed:{channelId:webhook.channelId,resourceId:webhook.resourceId,expiresAt:webhook.expiresAt?.toISOString()??null}};
  const saved=await db.update(backgroundJobs).set({payload:{connectionId:connection.id,encryptedCleanup:encryptCalendarSecret(confirmed)},updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,leaseToken))).returning({id:backgroundJobs.id});
  if(!saved.length)throw new Error("Calendar registration claim changed.");
  await db.transaction(async tx=>{
   const [claim]=await tx.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,leaseToken))).for("update");
   if(!claim)throw new Error("Calendar registration claim changed.");
   const adopted=await tx.update(calendarConnections).set({webhookAttemptId:connection.provider==="microsoft"?registrationAttemptId:null,webhookChannelId:webhook.channelId,webhookResourceId:webhook.resourceId,webhookExpiresAt:webhook.expiresAt,updatedAt:new Date()}).where(and(eq(calendarConnections.id,connection.id),eq(calendarConnections.status,"active"),eq(calendarConnections.encryptedCredentials,connection.encryptedCredentials))).returning({id:calendarConnections.id});
   if(!adopted.length)await tx.insert(backgroundJobs).values({organisationId:connection.organisationId,queue:"calendar_subscription",type:"stop_webhook",deduplicationKey:`calendar-stop:${connection.id}:${webhook.channelId}`,payload:{connectionId:connection.id,encryptedCleanup:encryptCalendarSecret({...snapshot,channelId:webhook.channelId,resourceId:webhook.resourceId})}}).onConflictDoNothing();
   await tx.update(backgroundJobs).set({status:"completed",lockedUntil:null,leaseToken:null,completedAt:new Date(),payload:{connectionId:connection.id},updatedAt:new Date()}).where(eq(backgroundJobs.id,job.id));
   await tx.insert(auditEvents).values({organisationId:connection.organisationId,action:"calendar.registration_recorded",resourceType:"background_job",resourceId:job.id,metadata:{provider:connection.provider,adopted:Boolean(adopted.length)}});
  });
  return webhook;
 }catch{
  await db.transaction(async tx=>{
   const saved=await tx.update(backgroundJobs).set({status:"failed",lockedUntil:null,leaseToken:null,failedAt:new Date(),error:"Initial calendar registration requires provider review.",updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,leaseToken))).returning({id:backgroundJobs.id});
   if(saved.length)await tx.insert(auditEvents).values({organisationId:connection.organisationId,action:"calendar.registration_review_required",resourceType:"background_job",resourceId:job.id,metadata:{provider:connection.provider}});
  });
  throw new Error("Initial calendar registration requires provider review.");
 }
}
