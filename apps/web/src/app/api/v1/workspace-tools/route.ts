import { assignedAuditScope, assignedClientScope, assignedJobScope, assignedPropertyScope } from "@/lib/workspace-scope";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { auditEvents, clients, createDatabase, customerQuotes, jobs, properties, userProfiles, withTenant } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { notificationResources } from "@/lib/notifications";
import { createHash } from "node:crypto";
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401,"unauthorised","Sign in to your practice.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const url=new URL(request.url),kind=url.searchParams.get("kind"),term=(url.searchParams.get("q")??"").trim();
  if(context.demo)return ok([]);
  if(kind!=="notifications"&&(term.length<2||term.length>100))return problem(400,"invalid_search","Enter between 2 and 100 characters.");
  return withTenant(createDatabase(),context.organisationId,async(tx)=>{
    if(kind==="notifications"){
      await tx.execute(sql`select set_config('app.current_user_id',${context.internalUserId??""},true)`);
      const [profile]=await tx.select({preferences:userProfiles.notifications}).from(userProfiles).where(eq(userProfiles.userId,context.internalUserId!)).limit(1);
      const resources=notificationResources(profile?.preferences??{},context.role);
      if(!resources.length)return ok([]);
      const rows=await tx.select({id:auditEvents.id,action:auditEvents.action,resourceType:auditEvents.resourceType,resourceId:auditEvents.resourceId,occurredAt:auditEvents.occurredAt}).from(auditEvents).where(and(assignedAuditScope(context),eq(auditEvents.organisationId,context.organisationId),inArray(auditEvents.resourceType,resources))).orderBy(desc(auditEvents.occurredAt)).limit(20);
      const destination:Record<string,string>={job:"jobs",quote:"customers?view=quotes",invoice:"finance",client_payment:"finance",appointment:"calendar",report_version:"reports",property:"properties"};
      return ok(rows.map(r=>({id:r.id,label:r.action.replaceAll("."," · ").replaceAll("_"," "),detail:r.occurredAt.toLocaleString("en-GB",{timeZone:"Europe/London"}),href:`/app/{slug}/${destination[r.resourceType]??"overview"}`})),{notificationScope:createHash("sha256").update(`${context.organisationId}:${context.internalUserId}:${context.workspaceMode}`).digest("hex").slice(0,24)});
    }
    const pattern=`%${term.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_")}%`,org=context.organisationId;
    const [customers,work,buildings,quotes]=await Promise.all([
      tx.select({id:clients.id,label:clients.displayName,detail:clients.email}).from(clients).where(and(assignedClientScope(context),eq(clients.organisationId,org),or(ilike(clients.displayName,pattern),ilike(clients.email,pattern)))).limit(8),
      tx.select({id:jobs.id,label:jobs.reference,detail:jobs.serviceName}).from(jobs).where(and(assignedJobScope(context),eq(jobs.organisationId,org),ilike(jobs.reference,pattern))).limit(8),
      tx.select({id:properties.id,label:properties.line1,detail:properties.postcode}).from(properties).where(and(assignedPropertyScope(context),eq(properties.organisationId,org),or(ilike(properties.line1,pattern),ilike(properties.postcode,pattern)))).limit(8),
      context.role === "surveyor" ? Promise.resolve([]) : tx.select({id:customerQuotes.id,label:customerQuotes.reference,detail:customerQuotes.status}).from(customerQuotes).where(and(eq(customerQuotes.organisationId,org),or(ilike(customerQuotes.reference,pattern),ilike(customerQuotes.email,pattern)))).limit(8),
    ]);
    return ok([...customers.map(r=>({...r,href:"/app/{slug}/customers"})),...work.map(r=>({...r,href:`/app/{slug}/jobs/${r.id}`})),...buildings.map(r=>({...r,href:`/app/{slug}/properties/${r.id}`})),...quotes.map(r=>({...r,href:"/app/{slug}/customers?view=quotes"}))]);
  });
}
