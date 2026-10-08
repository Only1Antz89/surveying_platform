import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, backgroundJobs, calendarConnections, createDatabase, withTenant } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
import { decryptCalendarSecret, encryptCalendarSecret } from "@/lib/calendar-oauth";
export async function GET(request:Request){
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to view your calendars.");
  if(context.demo)return ok([],{demo:true});
  return withTenant(createDatabase(),context.organisationId,async tx=>ok(await tx.select({id:calendarConnections.id,provider:calendarConnections.provider,status:calendarConnections.status,lastSyncedAt:calendarConnections.lastSyncedAt}).from(calendarConnections).where(and(eq(calendarConnections.organisationId,context.organisationId),eq(calendarConnections.userId,context.internalUserId!)))));
}
export async function POST(request:Request){
  const context=await apiContext(request);if(!context?.internalUserId)return problem(401,"unauthorised","Sign in to manage your own calendars.");
  if(!canWriteWorkspace(context))return problem(403,"forbidden","This workspace cannot change connections.");
  const parsed=await parseBody(request,z.object({id:z.uuid(),action:z.enum(["sync","disconnect"])}));if(!parsed.success)return problem(400,"invalid_request","Choose a connection and action.");
  if(context.demo||await isDemoOrganisation(context.organisationId))return problem(409,"demo_isolated","Demo calendars cannot change live provider connections.");
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    const [connection]=await tx.select().from(calendarConnections).where(and(eq(calendarConnections.id,parsed.data.id),eq(calendarConnections.organisationId,context.organisationId),eq(calendarConnections.userId,context.internalUserId!))).for("update");
    if(!connection)return problem(404,"not_found","Your calendar connection was not found.");
    const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${connection.id}`},0)) as acquired`);
    if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)return problem(409,"sync_in_progress","The calendar is synchronising. Retry this action after it finishes.");
    if(parsed.data.action==="disconnect"){
      if(connection.webhookChannelId && connection.encryptedCredentials){
        let encryptedCleanup:string|null=null;
        try{
          const tokens=decryptCalendarSecret<unknown>(connection.encryptedCredentials);
          encryptedCleanup=encryptCalendarSecret({connectionId:connection.id,organisationId:connection.organisationId,userId:connection.userId,provider:connection.provider,channelId:connection.webhookChannelId,resourceId:connection.webhookResourceId,tokens});
        }catch{/* Preserve the local disconnect; an unreadable credential needs operator review. */}
        await tx.insert(backgroundJobs).values({organisationId:context.organisationId,queue:"calendar_subscription",type:"stop_webhook",deduplicationKey:`calendar-stop:${connection.id}:${connection.webhookChannelId}`,status:encryptedCleanup?"queued":"failed",payload:{connectionId:connection.id,encryptedCleanup},error:encryptedCleanup?null:"Calendar subscription credentials require review before cleanup."}).onConflictDoNothing();
      }
      await tx.update(calendarConnections).set({status:"revoked",encryptedCredentials:"",syncCursor:null,updatedAt:new Date()}).where(eq(calendarConnections.id,connection.id));
    }
    else{
      if(connection.status!=="active")return problem(409,"reconnect_required","Reconnect this calendar before synchronising.");
      await tx.insert(backgroundJobs).values({organisationId:context.organisationId,queue:"calendar",type:"calendar_reconcile",deduplicationKey:`calendar-manual:${connection.id}:${Math.floor(Date.now()/60000)}`,payload:{connectionId:connection.id}}).onConflictDoNothing();
    }
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:`calendar.${parsed.data.action}_requested`,resourceType:"calendar_connection",resourceId:connection.id,metadata:{provider:connection.provider}});
    return ok({queued:parsed.data.action==="sync",disconnected:parsed.data.action==="disconnect"});
  });
}
