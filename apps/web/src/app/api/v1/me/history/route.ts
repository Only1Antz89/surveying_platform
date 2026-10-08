import { auth } from "@clerk/nextjs/server";
import { and,desc,eq,inArray,sql } from "drizzle-orm";
import { auditEvents,createDatabase,users } from "@surveynt/db";
import { isClerkConfigured } from "@/lib/access";
import { ok,problem } from "@/lib/api";

export async function GET(){
  if(!isClerkConfigured())return ok([],{demo:true,persisted:false});
  const session=await auth();if(!session.userId)return problem(401,"unauthorised","Sign in to view your account history.");
  if(!process.env.DATABASE_APP_URL&&!process.env.DATABASE_URL)return problem(503,"history_unavailable","Account history is not configured.");
  const db=createDatabase();
  const [user]=await db.select({id:users.id}).from(users).where(eq(users.clerkUserId,session.userId)).limit(1);
  if(!user)return problem(503,"account_pending","Your account has not synchronised yet. Retry shortly.");
  const rows=await db.transaction(async tx=>{
    await tx.execute(sql`select set_config('app.current_user_id',${user.id},true)`);
    return tx.select({id:auditEvents.id,action:auditEvents.action,occurredAt:auditEvents.occurredAt,metadata:auditEvents.metadata}).from(auditEvents).where(and(eq(auditEvents.resourceType,"user"),eq(auditEvents.resourceId,user.id),inArray(auditEvents.action,["account.created","account.profile_synchronised","account.profile_event_ignored","account.settings_updated"]))).orderBy(desc(auditEvents.occurredAt),desc(auditEvents.id)).limit(50);
  });
  const response=ok(rows.map(row=>({id:row.id,action:row.action,occurredAt:row.occurredAt,changedFields:Array.isArray(row.metadata.changedFields)?row.metadata.changedFields.filter((field):field is string=>typeof field==="string"&&["email","firstName","lastName","photo"].includes(field)):Array.isArray(row.metadata.changed)?row.metadata.changed.filter((field):field is string=>typeof field==="string"&&["professionalDetails","ricsNumber","appearance","notifications","work","reportName","reportContact"].includes(field)):[]})),{limit:50});
  response.headers.set("cache-control","private, no-store");
  return response;
}
