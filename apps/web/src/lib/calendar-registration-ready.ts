import {and,eq,sql} from "drizzle-orm";
import {backgroundJobs,calendarConnections,type Database} from "@surveynt/db";
import {z} from "zod";
import {calendarWebhookToken,decryptCalendarSecret,encryptCalendarSecret,registerCalendarWebhook} from "./calendar-oauth";
import {cleanupTokensSchema,refreshCleanupTokens,CalendarSubscriptionError} from "./calendar-subscription";
import {recoverConfirmedCalendarRegistration} from "./calendar-registration-recovery";
const schema=z.object({connectionId:z.uuid(),organisationId:z.uuid(),userId:z.uuid(),provider:z.enum(["google","microsoft"]),providerAccountId:z.string().min(1),registrationAttemptId:z.uuid(),channelId:z.string().nullable(),expectedCredentials:z.string(),origin:z.string().url(),phase:z.literal("ready"),tokens:cleanupTokensSchema.passthrough()}).passthrough();
/** Only a durable pre-dispatch attempt may issue its first creation. */
export async function processReadyCalendarRegistration(db:Database,job:typeof backgroundJobs.$inferSelect){
 let snapshot:z.infer<typeof schema>;
 try{snapshot=schema.parse(decryptCalendarSecret(String(job.payload.encryptedCleanup??"")));}catch{throw new CalendarSubscriptionError(true);}
 if(snapshot.organisationId!==job.organisationId||snapshot.connectionId!==job.payload.connectionId||!process.env.CALENDAR_WEBHOOK_SECRET)throw new CalendarSubscriptionError(true);
 const origin=new URL(snapshot.origin);if(origin.protocol!=="https:"||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash||(snapshot.provider==="google"&&!z.uuid().safeParse(snapshot.channelId).success))throw new CalendarSubscriptionError(true);
 const save=async(value:Record<string,unknown>)=>{
  const payload={connectionId:snapshot.connectionId,encryptedCleanup:encryptCalendarSecret(value)};
  const rows=await db.update(backgroundJobs).set({payload,updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,job.leaseToken!))).returning({id:backgroundJobs.id});
  if(!rows.length)throw new CalendarSubscriptionError(true);return payload;
 };
 const result=await db.transaction(async tx=>{
  const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${snapshot.connectionId}`},0)) as acquired`);
  if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)throw new CalendarSubscriptionError(false);
  const [connection]=await tx.select().from(calendarConnections).where(eq(calendarConnections.id,snapshot.connectionId)).for("update");
  if(!connection||connection.organisationId!==snapshot.organisationId||connection.userId!==snapshot.userId||connection.provider!==snapshot.provider||connection.providerAccountId!==snapshot.providerAccountId)throw new CalendarSubscriptionError(true);
  if(connection.status!=="active"||connection.webhookChannelId||connection.encryptedCredentials!==snapshot.expectedCredentials)return null;
  snapshot.tokens={...snapshot.tokens,...await refreshCleanupTokens(snapshot.provider,snapshot.tokens)};
  await save(snapshot);
  const dispatched={...snapshot,phase:"dispatched",applicationId:snapshot.provider==="microsoft"?process.env.MICROSOFT_CALENDAR_CLIENT_ID:undefined,clientState:snapshot.provider==="microsoft"?calendarWebhookToken(snapshot.connectionId,snapshot.registrationAttemptId):null};
  await save(dispatched);
  let webhook;try{webhook=await registerCalendarWebhook(snapshot.provider,snapshot.connectionId,snapshot.tokens.access_token,snapshot.origin,snapshot.channelId??undefined,snapshot.registrationAttemptId);}catch{throw new CalendarSubscriptionError(true);}
  if(!webhook)throw new CalendarSubscriptionError(true);
  return save({...dispatched,phase:"confirmed",channelId:webhook.channelId,confirmed:{...webhook,expiresAt:webhook.expiresAt?.toISOString()??null}});
 });
 if(!result)return "cancelled";
 return recoverConfirmedCalendarRegistration(db,{...job,payload:result});
}
