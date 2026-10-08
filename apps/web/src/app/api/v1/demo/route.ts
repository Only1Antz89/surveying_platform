import {workspaceAudit} from "@/lib/workspace-audit";
import { refreshInvoiceBalance } from "@/lib/invoice-balance";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, createDatabase, customerQuotes, organisationMemberships, organisations, clientPayments, invoices, settlementLedger, calendarConflicts, withTenant } from "@surveynt/db";
import { canManageTeam } from "@surveynt/domain";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { isDemoOrganisation, issueDemoCustomerLink, seedStakeholderDemo } from "@/lib/stakeholder-demo";
import { seedDemoEvidence } from "@/lib/demo-evidence";
import { seedDemoEvidenceDocuments } from "@/lib/demo-evidence-documents";
import { PreinspectionError } from "@/lib/preinspection";
const schema=z.discriminatedUnion("action",[z.object({action:z.literal("create")}),z.object({action:z.literal("prepare_evidence")}),z.object({action:z.literal("prepare_documents"),quoteId:z.uuid()}),z.object({action:z.literal("reset"),confirm:z.literal(true)}),z.object({action:z.literal("customer_link"),quoteId:z.uuid()}),z.object({action:z.literal("refund"),requestId:z.uuid(),paymentId:z.uuid(),amountMinor:z.number().int().positive()}),z.object({action:z.literal("resolve_conflict"),conflictId:z.uuid()})]);
export async function GET(request:Request){const c=await apiContext(request);if(!c)return problem(401,"unauthorised","Sign in to open the demo.");const accessDenial=await workspaceApiGuard(request,c);if(accessDenial)return accessDenial;if(c.demo)return ok({preview:true,isDemo:false,quotes:[],generation:0});if(!canManageTeam(c.role))return problem(403,"forbidden","Only practice owners and administrators can operate demo scenarios.");const db=createDatabase();const [org]=await db.select().from(organisations).where(eq(organisations.id,c.organisationId)).limit(1);if(!org?.isDemo)return ok({isDemo:false});const quotes=await withTenant(db,c.organisationId,(tx)=>tx.select({id:customerQuotes.id,reference:customerQuotes.reference,firstName:customerQuotes.firstName,status:customerQuotes.status}).from(customerQuotes).where(eq(customerQuotes.organisationId,c.organisationId)));return ok({isDemo:true,generation:org.demoGeneration,canPrepareEvidence:c.role==="owner"&&canWriteWorkspace(c),quotes});}
export async function POST(request:Request){const c=await apiContext(request);if(!c)return problem(401,"unauthorised","Sign in to open the demo.");const accessDenial=await workspaceApiGuard(request,c);if(accessDenial)return accessDenial;if(c.demo||!c.internalUserId)return problem(409,"sign_in_required","Sign in to create a persistent stakeholder practice.");if(!canManageTeam(c.role)||!canWriteWorkspace(c))return problem(403,"forbidden","Only practice owners and administrators can operate demo scenarios.");const parsed=await parseBody(request,schema);if(!parsed.success)return problem(400,"invalid_request","Check the demo request.");if(!process.env.DATABASE_ADMIN_URL)return problem(503,"unavailable","Demo provisioning is not configured.");const db=createDatabase(process.env.DATABASE_ADMIN_URL);const input=parsed.data;
  if(input.action==="create"){
    const slug=`surveynt-demo-${c.internalUserId}`;
    const org=await db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`demo-provision:${c.internalUserId}`}))`);
      const [existing]=await tx.select().from(organisations).where(eq(organisations.slug,slug)).limit(1);
      if(existing){
        const [member]=await tx.select({id:organisationMemberships.id}).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,existing.id),eq(organisationMemberships.userId,c.internalUserId!),eq(organisationMemberships.active,true))).limit(1);
        return member&&existing.isDemo&&existing.status==="active"?existing:null;
      }
      const clerk=await clerkClient();
      // Recover an organisation created before an interrupted local insert.
      let external;
      try { external=await clerk.organizations.getOrganization({slug}); }
      catch(error){if((error as {status?:number}).status!==404)throw error;}
      if(external&&external.createdBy!==c.userId)return null;
      external??=await clerk.organizations.createOrganization({name:"Surveynt Demo Practice",slug,createdBy:c.userId});
      const [created]=await tx.insert(organisations).values({clerkOrganisationId:external.id,slug,name:"Surveynt Demo Practice",practiceType:"building_surveying",region:"Bristol, United Kingdom",status:"active",isDemo:true,demoGeneration:1}).onConflictDoUpdate({target:organisations.clerkOrganisationId,set:{isDemo:true,demoGeneration:1,status:"active"}}).returning();
      await tx.insert(organisationMemberships).values({organisationId:created.id,userId:c.internalUserId!,role:"owner",active:true}).onConflictDoUpdate({target:[organisationMemberships.organisationId,organisationMemberships.userId],set:{role:"owner",active:true}});
      return created;
    });
    if(!org)return problem(403,"forbidden","This demo is not accessible to your account.");
    await seedStakeholderDemo(org.id,c.internalUserId,db);return ok({slug:org.slug,clerkOrganisationId:org.clerkOrganisationId});
  }
  if(!await isDemoOrganisation(c.organisationId,db))return problem(403,"demo_only","This action is only available inside a demo practice.");
  if(input.action==="prepare_evidence"){
    try { return ok(await seedDemoEvidence(c,db)); }
    catch(error){if(error instanceof PreinspectionError)return problem(error.status,error.code,error.message);throw error;}
  }
  if(input.action==="prepare_documents"){
    try { return ok(await seedDemoEvidenceDocuments(c,input.quoteId,db)); }
    catch(error){if(error instanceof PreinspectionError)return problem(error.status,error.code,error.message);throw error;}
  }
  if(input.action==="customer_link")return ok(await issueDemoCustomerLink(c.organisationId,input.quoteId,c.internalUserId));
  if(input.action==="reset"){
    if(c.role!=="owner")return problem(403,"owner_required","Only the demo practice owner can reset its generation.");
    const org=await db.transaction(async(tx)=>{const [old]=await tx.select().from(organisations).where(eq(organisations.id,c.organisationId)).for("update").limit(1);if(!old?.isDemo||old.status!=="active")throw new Error("Demo changed. Reload before resetting.");const members=await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,old.id),eq(organisationMemberships.active,true)));await tx.update(organisations).set({slug:`${old.slug}-archive-${old.demoGeneration}`,clerkOrganisationId:`archived:${old.id}`,status:"closed",updatedAt:new Date()}).where(eq(organisations.id,old.id));const [next]=await tx.insert(organisations).values({clerkOrganisationId:old.clerkOrganisationId,slug:old.slug,name:old.name,practiceType:old.practiceType,region:old.region,status:"active",isDemo:true,demoGeneration:old.demoGeneration+1}).returning();await tx.insert(organisationMemberships).values(members.map((m)=>({organisationId:next.id,userId:m.userId,role:m.role,canRecordSurvey:m.canRecordSurvey,canApproveReports:m.canApproveReports,active:true})));await tx.insert(auditEvents).values(workspaceAudit(c,{organisationId:old.id,actorUserId:c.internalUserId,action:"demo.archived",resourceType:"organisation",resourceId:old.id,metadata:{nextOrganisationId:next.id}}));return next;});await seedStakeholderDemo(org.id,c.internalUserId,db);return ok({slug:org.slug,clerkOrganisationId:org.clerkOrganisationId});
  }
  if(input.action==="refund")return withTenant(db,c.organisationId,async tx=>{
    const [candidate]=await tx.select({invoiceId:clientPayments.invoiceId}).from(clientPayments).where(and(eq(clientPayments.id,input.paymentId),eq(clientPayments.organisationId,c.organisationId))).limit(1);
    if(!candidate)return problem(404,"not_found","Payment not found.");
    const [invoice]=await tx.select().from(invoices).where(and(eq(invoices.id,candidate.invoiceId),eq(invoices.organisationId,c.organisationId))).for("update").limit(1);
    const [payment]=await tx.select().from(clientPayments).where(and(eq(clientPayments.id,input.paymentId),eq(clientPayments.organisationId,c.organisationId))).for("update").limit(1);
    const [previous]=await tx.select({metadata:auditEvents.metadata}).from(auditEvents).where(and(eq(auditEvents.organisationId,c.organisationId),eq(auditEvents.action,"demo.refund_simulated"),eq(auditEvents.resourceId,input.paymentId),sql`${auditEvents.metadata}->>'requestId'=${input.requestId}`)).limit(1);
    if(previous){if(previous.metadata.amountMinor!==input.amountMinor)return problem(409,"request_changed","A refund request ID cannot be reused with a different amount.");return ok({refundedMinor:payment?.refundedMinor,demo:true,duplicate:true});}
    if(!invoice||!payment||!payment.succeededAt||input.amountMinor>payment.amountMinor-payment.refundedMinor)return problem(409,"not_refundable","Check the refundable amount.");
    const refundedMinor=payment.refundedMinor+input.amountMinor;
    await tx.update(clientPayments).set({refundedMinor,status:refundedMinor===payment.amountMinor?"refunded":"partially_refunded",updatedAt:new Date()}).where(and(eq(clientPayments.id,payment.id),eq(clientPayments.organisationId,c.organisationId)));
    await tx.insert(settlementLedger).values({organisationId:c.organisationId,paymentId:payment.id,currency:payment.currency,entryType:"refund",amountMinor:-input.amountMinor,metadata:{demo:true},createdByUserId:c.internalUserId});
    await refreshInvoiceBalance(tx,invoice);
    await tx.insert(auditEvents).values(workspaceAudit(c,{organisationId:c.organisationId,actorUserId:c.internalUserId,action:"demo.refund_simulated",resourceType:"client_payment",resourceId:payment.id,metadata:{amountMinor:input.amountMinor,requestId:input.requestId}}));
    return ok({refundedMinor,demo:true});
  });
  return withTenant(db,c.organisationId,async(tx)=>{const [conflict]=await tx.update(calendarConflicts).set({status:"resolved",resolvedAt:new Date(),resolvedByUserId:c.internalUserId,updatedAt:new Date()}).where(and(eq(calendarConflicts.id,input.conflictId),eq(calendarConflicts.organisationId,c.organisationId),eq(calendarConflicts.status,"open"))).returning();if(!conflict)return problem(404,"not_found","Conflict not found.");await tx.insert(auditEvents).values(workspaceAudit(c,{organisationId:c.organisationId,actorUserId:c.internalUserId,action:"calendar.conflict_resolved",resourceType:"calendar_conflict",resourceId:conflict.id,metadata:{decision:"keep_surveynt",demo:true}}));return ok({resolved:true});});
}
