import {createHash,randomUUID} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {auditEvents,backgroundJobs,calendarConnections,type Database} from "@surveynt/db";
import {z} from "zod";
import {decryptCalendarSecret,encryptCalendarSecret} from "./calendar-oauth";
import {cleanupTokensSchema} from "./calendar-subscription";
export const missingChannelReviewSchema=z.object({reviewVersion:z.string().regex(/^[a-f0-9]{64}$/),verifiedAccountId:z.string().trim().min(1).max(2048),evidence:z.string().trim().min(15).max(2000),confirmed:z.literal(true)});
export function calendarConnectionReviewVersion(row:typeof calendarConnections.$inferSelect){return createHash("sha256").update(JSON.stringify({id:row.id,organisationId:row.organisationId,userId:row.userId,provider:row.provider,account:row.providerAccountId,status:row.status,channel:row.webhookChannelId,credentials:row.encryptedCredentials,updatedAt:row.updatedAt.toISOString()})).digest("hex");}
export async function queueReviewedMissingChannel(db:Database,id:string,staffId:string,input:z.infer<typeof missingChannelReviewSchema>){
 return db.transaction(async tx=>{
  const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${id}`},0)) as acquired`);
  if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)throw new Error("The connection is busy. Reload before reviewing.");
  const [connection]=await tx.select().from(calendarConnections).where(eq(calendarConnections.id,id)).for("update");
  if(!connection||connection.status!=="active"||connection.webhookChannelId||calendarConnectionReviewVersion(connection)!==input.reviewVersion||connection.providerAccountId!==input.verifiedAccountId||!["google","microsoft"].includes(connection.provider))throw new Error("Reload and verify the current active account without a recorded channel.");
  const [pending]=await tx.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.organisationId,connection.organisationId),eq(backgroundJobs.queue,"calendar_subscription"),sql`${backgroundJobs.payload}->>'connectionId' = ${connection.id}`,sql`${backgroundJobs.status} not in ('completed','cancelled')`)).limit(1);
  if(pending)throw new Error("Resolve the existing subscription attempt before creating another.");
  let tokens:z.infer<typeof cleanupTokensSchema>,origin:string;
  try{tokens=cleanupTokensSchema.parse(decryptCalendarSecret(connection.encryptedCredentials));const url=new URL(process.env.APP_URL??"");if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash||!process.env.CALENDAR_WEBHOOK_SECRET)throw new Error();origin=url.origin;}catch{throw new Error("Review the encrypted credentials, HTTPS application origin and webhook configuration first.");}
  const registrationAttemptId=randomUUID(),channelId=connection.provider==="google"?randomUUID():null;
  const [job]=await tx.insert(backgroundJobs).values({organisationId:connection.organisationId,queue:"calendar_subscription",type:"register_webhook",deduplicationKey:`calendar-register:${connection.id}:${registrationAttemptId}`,availableAt:new Date(),payload:{connectionId:connection.id,encryptedCleanup:encryptCalendarSecret({connectionId:connection.id,organisationId:connection.organisationId,userId:connection.userId,provider:connection.provider,providerAccountId:connection.providerAccountId,registrationAttemptId,channelId,origin,expectedCredentials:connection.encryptedCredentials,tokens,phase:"ready"})}}).returning();
  await tx.insert(auditEvents).values({organisationId:connection.organisationId,platformStaffId:staffId,action:"calendar.missing_channel_reviewed",resourceType:"calendar_connection",resourceId:connection.id,metadata:{reviewVersion:input.reviewVersion,evidence:input.evidence,provider:connection.provider,registrationAttemptId,jobId:job.id}});
  return {id:job.id,status:job.status};
 });
}
