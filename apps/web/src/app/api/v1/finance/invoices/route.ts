import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, createDatabase, invoiceLineItems, invoices, jobs, withTenant } from "@surveynt/db";
import { canManageFinance } from "@surveynt/domain";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const schema=z.object({requestId:z.uuid(),jobId:z.uuid().nullable().default(null),currency:z.enum(["GBP","EUR","USD"]),dueAt:z.iso.datetime().nullable().default(null),lines:z.array(z.object({description:z.string().trim().min(1).max(500),quantity:z.number().int().min(1).max(1000),unitAmountMinor:z.number().int().min(1).max(100000000),vatBasisPoints:z.number().int().min(0).max(10000)})).min(1).max(50)});
export async function POST(request:Request){
  const context=await apiContext(request);
  if(!context)return problem(401,"unauthorised","Sign in to create an invoice.");
  if(!canWriteWorkspace(context)||!canManageFinance(context.role))return problem(403,"forbidden","Only owners and administrators can create invoices.");
  if(context.demo)return problem(409,"preview_only","Sign in to the private demo for persistent invoices.");
  const parsed=await parseBody(request,schema);if(!parsed.success)return problem(400,"invalid_request","Check the invoice fields.");
  const input=parsed.data,subtotalMinor=input.lines.reduce((sum,line)=>sum+line.quantity*line.unitAmountMinor,0),vatMinor=input.lines.reduce((sum,line)=>sum+Math.round(line.quantity*line.unitAmountMinor*line.vatBasisPoints/10000),0),totalMinor=subtotalMinor+vatMinor;
  if(totalMinor>2147483647)return problem(400,"amount_too_large","The invoice amount exceeds the supported limit.");
  const fingerprint=createHash("sha256").update(JSON.stringify(input)).digest("hex"),number="INV-"+input.requestId.replaceAll("-","").toUpperCase();
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organisationId}:invoice:${input.requestId}`}))`);
    const [existing]=await tx.select().from(invoices).where(and(eq(invoices.organisationId,context.organisationId),eq(invoices.number,number))).limit(1);
    if(existing){const [audit]=await tx.select({metadata:auditEvents.metadata}).from(auditEvents).where(and(eq(auditEvents.organisationId,context.organisationId),eq(auditEvents.resourceId,existing.id),eq(auditEvents.action,"invoice.created"))).limit(1);return audit?.metadata.fingerprint===fingerprint?ok(existing,{duplicate:true}):problem(409,"request_changed","A request ID cannot be reused with different invoice details.");}
    if(input.jobId){const [job]=await tx.select({id:jobs.id}).from(jobs).where(and(eq(jobs.id,input.jobId),eq(jobs.organisationId,context.organisationId))).limit(1);if(!job)return problem(404,"job_not_found","Choose a job from this practice.");}
    const [invoice]=await tx.insert(invoices).values({organisationId:context.organisationId,jobId:input.jobId,number,currency:input.currency,status:"draft",subtotalMinor,vatMinor,totalMinor,dueAt:input.dueAt?new Date(input.dueAt):null}).returning();
    await tx.insert(invoiceLineItems).values(input.lines.map(line=>({...line,organisationId:context.organisationId,invoiceId:invoice.id})));
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"invoice.created",resourceType:"invoice",resourceId:invoice.id,metadata:{fingerprint,requestId:input.requestId,totalMinor,currency:input.currency}});
    return ok(invoice);
  });
}
