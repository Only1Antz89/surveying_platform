import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { appointments, backgroundJobs, jobStageEvents, auditEvents, clients, jobs, properties, availabilityBlocks, calendarConflicts, calendarConnections, clientPayments, createDatabase, invoices, organisationDocuments, reportDeliveries, organisationMemberships, organisationOperationalSettings, organisations, settlementLedger, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { syncSourceRegistry } from "@surveynt/property-data/importers";
import Stripe from "stripe";
vi.mock("server-only", () => ({}));

const state=vi.hoisted(()=>({context:{organisationId:"",internalUserId:"",userId:"user_api_owner",role:"owner",demo:false,accessLevel:"full"},remove:vi.fn(),get:vi.fn(),put:vi.fn(async()=>undefined)}));
vi.mock("../src/lib/access",()=>({apiContext:async()=>state.context,canWriteWorkspace:()=>true,isClerkConfigured:()=>false}));
vi.mock("../src/lib/storage",()=>({getObjectStorage:()=>({remove:state.remove,get:state.get,put:state.put}),maxUploadBytes:()=>10000}));
import { processDocumentRemovalQueue } from "../src/lib/document-removal";
import { POST as reviewRemoval } from "../src/app/api/v1/documents/[id]/removal-review/route";
import { POST as requestRemoval, PATCH as cancelRemoval } from "../src/app/api/v1/documents/[id]/removal/route";
import { PATCH as saveTemplates } from "../src/app/api/v1/operations/email-templates/route";
import { PATCH as reviewRetention } from "../src/app/api/v1/documents/[id]/retention/route";
import { PATCH as reviewRetentionPolicy } from "../src/app/api/v1/operations/retention-policy/route";
import { PATCH as reviewJobHold } from "../src/app/api/v1/jobs/[id]/retention/route";
import { jobRetentionHolds, withTenant } from "@surveynt/db";
import { GET as capabilities } from "../src/app/api/v1/capabilities/route";
import { GET as demoCatalogue, POST as demoAction } from "../src/app/api/v1/demo/route";
import { GET as download, DELETE as archive, PATCH as protection, POST as restore } from "../src/app/api/v1/documents/[id]/route";
import { POST as createInvoice } from "../src/app/api/v1/finance/invoices/route";
import { GET as invoiceDetail, POST as invoiceAction } from "../src/app/api/v1/finance/invoices/[id]/route";
import { POST as manageAppointment } from "../src/app/api/v1/calendar/appointments/route";
import { GET as availability } from "../src/app/api/v1/calendar/availability/route";
import { POST as settlement } from "../src/app/api/v1/finance/settlements/route";
import { POST as upload, GET as documentList } from "../src/app/api/v1/documents/route";
import { POST as stripeWebhook } from "../src/app/api/webhooks/stripe/route";

describe.skipIf(!integrationEnabled)("polish API safety and readiness",()=>{
  let database:TestDatabase,db:Database,orgId:string,demoId:string,ownerId:string;
  const request=(path:string,method="GET",body?:unknown)=>new Request(`http://surveynt.test${path}`,{method,headers:{"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  beforeAll(async()=>{
    database=await createTestDatabase();vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("DATABASE_APP_URL",database.appUrl);db=createDatabase(database.adminUrl);await syncSourceRegistry(db);
    const [owner]=await db.insert(users).values({clerkUserId:"user_api_owner",email:"owner-api@example.test"}).returning();ownerId=owner.id;
    const [live,demo]=await db.insert(organisations).values([{clerkOrganisationId:"org_api_live",slug:"api-live",name:"API readiness",practiceType:"building_surveying",region:"Bristol",status:"active"},{clerkOrganisationId:"org_api_demo",slug:"api-demo",name:"API demo",practiceType:"building_surveying",region:"Bristol",status:"active",isDemo:true}]).returning();orgId=live.id;demoId=demo.id;
    await db.insert(organisationOperationalSettings).values({organisationId:orgId,publicQuotesEnabled:false,clientPaymentsEnabled:false});
    await db.insert(organisationMemberships).values([{organisationId:orgId,userId:ownerId,role:"owner"},{organisationId:demoId,userId:ownerId,role:"owner"}]);
    Object.assign(state.context,{organisationId:orgId,internalUserId:ownerId});
  },120000);
  afterAll(async()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();await database?.drop();await stopRelay();});
  it("audits job holds with tenant binding, concurrent guards and reviewed clearance",async()=>{
    Object.assign(state.context,{organisationId:orgId,internalUserId:ownerId,role:"owner",demo:false});
    const [client]=await db.insert(clients).values({organisationId:orgId,kind:"individual",displayName:"Hold fixture"}).returning();
    const [property]=await db.insert(properties).values({organisationId:orgId,clientId:client.id,line1:"1 Hold Street",city:"Bristol",postcode:"BS1 1AA",country:"ENG"}).returning();
    const [job]=await db.insert(jobs).values({organisationId:orgId,clientId:client.id,propertyId:property.id,reference:"HOLD-1",serviceName:"Survey"}).returning();
    const route={params:Promise.resolve({id:job.id})};
    const body={expectedRevision:0,kind:"claim",reason:"Open professional claim requires retention of the complete file.",confirmed:true};
    const outcomes=await Promise.all([1,2].map(()=>reviewJobHold(request("/retention","PATCH",body),route)));
    expect(outcomes.map(response=>response.status).sort()).toEqual([200,409]);
    const [hold]=await db.select().from(jobRetentionHolds).where(eq(jobRetentionHolds.jobId,job.id));expect(hold).toMatchObject({kind:"claim",revision:1,reviewedByUserId:ownerId});
    state.context.organisationId=demoId;expect((await reviewJobHold(request("/retention","PATCH",{...body,expectedRevision:1}),route)).status).toBe(404);state.context.organisationId=orgId;
    state.context.role="surveyor";expect((await reviewJobHold(request("/retention","PATCH",{...body,expectedRevision:1}),route)).status).toBe(403);state.context.role="owner";
    expect((await reviewJobHold(request("/retention","PATCH",{...body,expectedRevision:1,kind:null,reason:"Claim concluded and clearance authority reviewed by manager."}),route)).status).toBe(200);
    const [cleared]=await db.select().from(jobRetentionHolds).where(eq(jobRetentionHolds.jobId,job.id));expect(cleared).toMatchObject({kind:null,revision:2});
    const audits=await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,job.id),eq(auditEvents.action,"job.retention_hold_cleared")));expect(audits).toHaveLength(1);
    await expect(db.insert(jobRetentionHolds).values({organisationId:demoId,jobId:job.id,reason:body.reason,kind:"legal",reviewedByUserId:ownerId})).rejects.toThrow();
    expect(await withTenant(createDatabase(),demoId,tx=>tx.select().from(jobRetentionHolds).where(eq(jobRetentionHolds.jobId,job.id)))).toEqual([]);
  });
  it("records one concurrent practice policy approval and rejects stale or unauthorised reviews",async()=>{
    Object.assign(state.context,{organisationId:orgId,internalUserId:ownerId,role:"owner",demo:false});
    const body={expectedRevision:0,policyVersion:"survey-file-1-year-v2",enabled:true,reason:"Practice manager reviewed the one-year survey file policy.",confirmed:true};
    const responses=await Promise.all([1,2].map(()=>reviewRetentionPolicy(request("/api/v1/operations/retention-policy","PATCH",body))));
    expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
    const [settings]=await db.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,orgId));
    expect(settings.surveyFileRetentionPolicy).toMatchObject({revision:1,version:body.policyVersion,enabled:true,approvedByUserId:ownerId});
    expect(settings.documentRetentionDays).toBe(2555);
    const audits=await db.select().from(auditEvents).where(and(eq(auditEvents.organisationId,orgId),eq(auditEvents.action,"firm.survey_retention_policy_reviewed")));
    expect(audits).toHaveLength(1);expect(audits[0].metadata).toMatchObject({years:1,automaticDeletion:false});
    state.context.role="surveyor";expect((await reviewRetentionPolicy(request("/api/v1/operations/retention-policy","PATCH",{...body,expectedRevision:1}))).status).toBe(403);
    state.context.role="administrator";expect((await reviewRetentionPolicy(request("/api/v1/operations/retention-policy","PATCH",{...body,expectedRevision:1}))).status).toBe(403);
    state.context.role="owner";state.context.demo=true;
    expect((await (await reviewRetentionPolicy(request("/api/v1/operations/retention-policy","PATCH",body))).json()).data.persisted).toBe(false);
    state.context.demo=false;
    expect((await reviewRetentionPolicy(request("/api/v1/operations/retention-policy","PATCH",{...body,expectedRevision:1,enabled:false}))).status).toBe(200);
    const [disabled]=await db.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,orgId));
    expect(disabled.surveyFileRetentionPolicy).toMatchObject({revision:2,enabled:false});
  });
  it("requires firm quote enablement and payment approval, without exposing configured secrets",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner"});
    vi.stubEnv("QUOTE_TOKEN_SECRET","private_test_quote_secret");vi.stubEnv("STRIPE_CLIENT_PAYMENTS_KEY","private_test_client_key");vi.stubEnv("CLIENT_PAYMENTS_LAUNCH_APPROVED","false");
    const response=await capabilities(request("/api/v1/capabilities")),body=await response.json();
    expect(body.data.find((row:{key:string})=>row.key==="quotes").state).toBe("Setup required");
    expect(body.data.find((row:{key:string})=>row.key==="payments").state).toBe("Pending approval");
    expect(JSON.stringify(body)).not.toContain("private_test_");
    await db.update(organisationOperationalSettings).set({publicQuotesEnabled:true}).where(eq(organisationOperationalSettings.organisationId,orgId));
    expect((await (await capabilities(request("/api/v1/capabilities"))).json()).data.find((row:{key:string})=>row.key==="quotes").state).toBe("Available");
  });
  it("keeps demo readiness isolated and rejects admin reset",async()=>{
    Object.assign(state.context,{organisationId:demoId,role:"administrator"});
    const body=await (await capabilities(request("/api/v1/capabilities"))).json();expect(body.data.filter((row:{key:string})=>!["record_survey","approve_reports"].includes(row.key)).every((row:{state:string;connectHref?:string})=>row.state==="Demo"&&!row.connectHref)).toBe(true);
    expect(body.data.find((row:{key:string})=>row.key==="record_survey").state).toBe("Unavailable");
    expect(body.data.find((row:{key:string})=>row.key==="approve_reports").state).toBe("Unavailable");
    expect((await demoAction(request("/api/v1/demo","POST",{action:"reset",confirm:true}))).status).toBe(403);
  });
  it("restricts the demo catalogue and new preparation operations independently of management access",async()=>{
    Object.assign(state.context,{organisationId:demoId,role:"surveyor"});
    expect((await demoCatalogue(request("/api/v1/demo"))).status).toBe(403);
    state.context.role="owner";
    const catalogue=await (await demoCatalogue(request("/api/v1/demo"))).json();
    expect(catalogue.data.canPrepareEvidence).toBe(true);
    for(const action of [{action:"prepare_evidence"},{action:"prepare_documents",quoteId:crypto.randomUUID()}]){
      state.context.role="administrator";
      expect((await demoAction(request("/api/v1/demo","POST",action))).status).toBe(403);
      state.context.role="owner";
      expect((await demoAction(request("/api/v1/demo","POST",action))).status).toBe(409);
      state.context.organisationId=orgId;
      expect((await demoAction(request("/api/v1/demo","POST",action))).status).toBe(403);
      state.context.organisationId=demoId;
    }
    expect(state.put).not.toHaveBeenCalled();
  });
  it("records a simulated refund once and aggregates all invoice payments",async()=>{
    Object.assign(state.context,{organisationId:demoId,role:"owner"});
    const [invoice]=await db.insert(invoices).values({organisationId:demoId,number:"REFUND-API",status:"paid",totalMinor:10000,subtotalMinor:10000,vatMinor:0}).returning();
    const [payment]=await db.insert(clientPayments).values([{organisationId:demoId,invoiceId:invoice.id,purpose:"deposit",status:"succeeded",succeededAt:new Date(),amountMinor:6000},{organisationId:demoId,invoiceId:invoice.id,purpose:"balance",status:"succeeded",succeededAt:new Date(),amountMinor:5000}]).returning();
    const body={action:"refund",requestId:crypto.randomUUID(),paymentId:payment.id,amountMinor:1000};
    const noExternal=vi.fn(()=>{throw new Error("Demo contacted an external service");});vi.stubGlobal("fetch",noExternal);
    const responses=await Promise.all([demoAction(request("/api/v1/demo","POST",body)),demoAction(request("/api/v1/demo","POST",body))]);expect(responses.every(response=>response.ok)).toBe(true);
    const [updated]=await db.select().from(invoices).where(eq(invoices.id,invoice.id));expect(updated.status).toBe("paid");
    const [refunded]=await db.select().from(clientPayments).where(eq(clientPayments.id,payment.id));expect(refunded.refundedMinor).toBe(1000);
    expect(await db.select().from(settlementLedger).where(and(eq(settlementLedger.organisationId,demoId),eq(settlementLedger.paymentId,payment.id)))).toHaveLength(1);
    expect((await demoAction(request("/api/v1/demo","POST",{...body,amountMinor:2000}))).status).toBe(409);
    expect(noExternal).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
  it("creates a draft exactly once, preserves VAT rounding and checks finance permissions",async()=>{
    Object.assign(state.context,{organisationId:demoId,role:"owner"});
    const body={requestId:crypto.randomUUID(),currency:"GBP",lines:[{description:"Fictional inspection",quantity:3,unitAmountMinor:101,vatBasisPoints:2000},{description:"Fictional administration",quantity:1,unitAmountMinor:99,vatBasisPoints:0}]};
    const responses=await Promise.all([createInvoice(request("/api/v1/finance/invoices","POST",body)),createInvoice(request("/api/v1/finance/invoices","POST",body))]);
    const bills=await Promise.all(responses.map(response=>response.json()));expect(bills[0].data.id).toBe(bills[1].data.id);expect(bills[0].data).toMatchObject({status:"draft",subtotalMinor:402,vatMinor:61,totalMinor:463});
    expect((await createInvoice(request("/api/v1/finance/invoices","POST",{...body,currency:"EUR"}))).status).toBe(409);
    const route={params:Promise.resolve({id:bills[0].data.id})};
    expect((await invoiceAction(request("/api/v1/finance/invoices/id","POST",{action:"issue"}),route)).ok).toBe(true);
    expect((await invoiceAction(request("/api/v1/finance/invoices/id","POST",{action:"issue"}),route)).status).toBe(409);
    state.context.role="surveyor";expect((await createInvoice(request("/api/v1/finance/invoices","POST",{...body,requestId:crypto.randomUUID()}))).status).toBe(403);
  });
  it("does not present draft or void invoices as collectible and rejects malformed IDs",async()=>{
    Object.assign(state.context,{organisationId:demoId,role:"owner"});
    const [draft]=await db.insert(invoices).values({organisationId:demoId,number:"DRAFT-NON-COLLECTIBLE",status:"draft",totalMinor:1200,subtotalMinor:1000,vatMinor:200}).returning();
    const route={params:Promise.resolve({id:draft.id})};
    expect((await (await invoiceDetail(request("/api/v1/finance/invoices/id"),route)).json()).data.outstandingMinor).toBe(0);
    expect((await invoiceAction(request("/api/v1/finance/invoices/id","POST",{action:"issue"}),route)).ok).toBe(true);
    expect((await (await invoiceDetail(request("/api/v1/finance/invoices/id"),route)).json()).data.outstandingMinor).toBe(1200);
    expect((await invoiceAction(request("/api/v1/finance/invoices/id","POST",{action:"void"}),route)).ok).toBe(true);
    expect((await (await invoiceDetail(request("/api/v1/finance/invoices/id"),route)).json()).data.outstandingMinor).toBe(0);
    const invalid={params:Promise.resolve({id:"not-a-uuid"})};
    expect((await invoiceDetail(request("/api/v1/finance/invoices/id"),invalid)).status).toBe(404);
    expect((await invoiceAction(request("/api/v1/finance/invoices/id","POST",{action:"void"}),invalid)).status).toBe(404);
    state.context.organisationId=orgId;expect((await invoiceDetail(request("/api/v1/finance/invoices/id"),route)).status).toBe(404);
  });
  it("limits personal availability and conflict details to the connected member",async()=>{
    const [other]=await db.insert(users).values({clerkUserId:"user_other_calendar",email:"calendar-other@example.test"}).returning();
    const start=new Date(),end=new Date(start.getTime()+3600000);
    const blocks=await db.insert(availabilityBlocks).values([
      {organisationId:orgId,userId:null,startsAt:start,endsAt:end,reason:"Practice closure"},
      {organisationId:orgId,userId:ownerId,startsAt:start,endsAt:end,reason:"Own busy period"},
      {organisationId:orgId,userId:other.id,startsAt:start,endsAt:end,reason:"Private colleague period"},
      {organisationId:demoId,userId:ownerId,startsAt:start,endsAt:end,reason:"Other tenant"},
    ]).returning();
    const connections=await db.insert(calendarConnections).values([
      {organisationId:orgId,userId:ownerId,provider:"google",providerAccountId:"own",encryptedCredentials:"must-not-leak"},
      {organisationId:orgId,userId:other.id,provider:"google",providerAccountId:"other",encryptedCredentials:"must-not-leak"},
    ]).returning();
    const conflicts=await db.insert(calendarConflicts).values(connections.map(connection=>({organisationId:orgId,connectionId:connection.id,kind:"version_changed",details:{note:connection.providerAccountId}}))).returning();
    Object.assign(state.context,{organisationId:orgId,role:"surveyor"});
    const limited=await (await availability(request("/api/v1/calendar/availability"))).json();
    expect(limited.data.blocks.map((row:{id:string})=>row.id).sort()).toEqual(blocks.slice(0,2).map(row=>row.id).sort());
    expect(limited.data.conflicts.map((row:{id:string})=>row.id)).toEqual([conflicts[0].id]);
    expect(limited.data.connections.map((row:{id:string})=>row.id)).toEqual([connections[0].id]);
    expect(JSON.stringify(limited)).not.toContain("must-not-leak");
    state.context.role="owner";
    const managed=await (await availability(request("/api/v1/calendar/availability"))).json();
    expect(managed.data.blocks).toHaveLength(3);expect(managed.data.conflicts).toHaveLength(2);
  });
  it("verifies Stripe signatures and handles replayed and out-of-order refund events",async()=>{
    vi.stubEnv("STRIPE_SECRET_KEY","stripe-test-placeholder");vi.stubEnv("STRIPE_WEBHOOK_SECRET","webhook-test-placeholder");
    const [invoice]=await db.insert(invoices).values({organisationId:orgId,number:"WEBHOOK-REFUND-TEST",status:"paid",subtotalMinor:1000,vatMinor:0,totalMinor:1000}).returning();
    const [payment]=await db.insert(clientPayments).values({organisationId:orgId,invoiceId:invoice.id,purpose:"balance",amountMinor:1000,status:"succeeded",succeededAt:new Date(),stripePaymentIntentId:"pi_local_webhook_test"}).returning();
    const stripe=new Stripe("stripe-test-placeholder");
    const event=(eventId:string,refunded:number)=>JSON.stringify({id:eventId,object:"event",type:"charge.refunded",created:Math.floor(Date.now()/1000),livemode:false,data:{object:{id:"ch_local_webhook_test",object:"charge",payment_intent:"pi_local_webhook_test",amount:1000,amount_refunded:refunded,currency:"gbp"}}});
    const deliver=(body:string,valid=true)=>stripeWebhook(new Request("http://surveynt.test/api/webhooks/stripe",{method:"POST",headers:{"stripe-signature":valid?stripe.webhooks.generateTestHeaderString({payload:body,secret:"webhook-test-placeholder"}):"invalid"},body}));
    const first=event("evt_local_refund_600",600);
    expect((await deliver(first,false)).status).toBe(400);
    const [unchanged]=await db.select().from(clientPayments).where(eq(clientPayments.id,payment.id));expect(unchanged.refundedMinor).toBe(0);
    expect((await deliver(first)).ok).toBe(true);
    expect((await (await deliver(first)).json()).duplicate).toBe(true);
    expect((await deliver(event("evt_local_old_refund_200",200))).ok).toBe(true);
    expect((await deliver(event("evt_local_new_refund_800",800))).ok).toBe(true);
    const [refunded]=await db.select().from(clientPayments).where(eq(clientPayments.id,payment.id));expect(refunded.refundedMinor).toBe(800);expect(refunded.status).toBe("partially_refunded");
    const ledger=await db.select().from(settlementLedger).where(eq(settlementLedger.paymentId,payment.id));expect(ledger).toHaveLength(2);expect(ledger.reduce((total,row)=>total+row.amountMinor,0)).toBe(-800);
    const [updated]=await db.select().from(invoices).where(eq(invoices.id,invoice.id));expect(updated.status).toBe("part_paid");
  });
  it("requires an exact reviewed settlement amount and serialises competing submissions",async()=>{
    Object.assign(state.context,{organisationId:demoId,role:"owner"});
    const entries=await db.insert(settlementLedger).values([{organisationId:demoId,entryType:"firm_liability",amountMinor:5000},{organisationId:demoId,entryType:"refund",amountMinor:-1000}]).returning();
    const body={reference:"EXTERNAL-DEMO-TEST",settledAt:new Date().toISOString(),expectedTotalMinor:4000,ledgerEntryIds:entries.map(entry=>entry.id),evidence:{note:"Fictional external settlement evidence"}};
    expect((await settlement(request("/api/v1/finance/settlements","POST",{...body,expectedTotalMinor:5000}))).status).toBe(409);
    expect((await settlement(request("/api/v1/finance/settlements","POST",{...body,ledgerEntryIds:[entries[0].id,entries[0].id]}))).status).toBe(400);
    const responses=await Promise.all([settlement(request("/api/v1/finance/settlements","POST",body)),settlement(request("/api/v1/finance/settlements","POST",body))]);expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
    state.context.organisationId=orgId;expect((await settlement(request("/api/v1/finance/settlements","POST",body))).status).toBe(409);
  });
  it("checks document scope and legal hold and preserves the original on archive",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner"});
    const [document]=await db.insert(organisationDocuments).values({organisationId:orgId,name:"Fictional file",category:"legal",accessClass:"restricted",blobUrl:"private://test",blobPathname:"test",checksum:"test",contentType:"text/plain",sizeBytes:1,legalHold:true}).returning();
    const route={params:Promise.resolve({id:document.id})};
    expect((await archive(request("/api/v1/documents/id","DELETE"),route)).status).toBe(409);
    state.context.role="surveyor";expect((await download(request("/api/v1/documents/id"),route)).status).toBe(404);expect(state.get).not.toHaveBeenCalled();
    state.context.role="owner";state.context.organisationId=demoId;expect((await download(request("/api/v1/documents/id"),route)).status).toBe(404);
    state.context.organisationId=orgId;
    expect((await protection(request("/api/v1/documents/id","PATCH",{category:"legal",retentionUntil:null,legalHold:false,accessClass:"job"}),route)).status).toBe(400);
    expect((await protection(request("/api/v1/documents/id","PATCH",{category:"legal",retentionUntil:null,legalHold:true,accessClass:"firm"}),route)).ok).toBe(true);
    const [shared]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,document.id));expect(shared.accessClass).toBe("firm");
    expect((await protection(request("/api/v1/documents/id","PATCH",{category:"legal",retentionUntil:null,legalHold:false}),route)).ok).toBe(true);
    expect((await archive(request("/api/v1/documents/id","DELETE"),route)).status).toBe(204);expect(state.remove).not.toHaveBeenCalled();
  });
  it("retains a replaced original and rejects stale or legal-held replacements before uploading",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner"});
    const retainedUntil=new Date(Date.now()+365*86400000);
    const [original]=await db.insert(organisationDocuments).values({organisationId:orgId,name:"Fictional original",category:"compliance",accessClass:"restricted",blobUrl:"private://original",blobPathname:"original",checksum:"original-checksum",contentType:"text/plain",sizeBytes:1,retentionUntil:retainedUntil}).returning();
    const replace=(id:string,checksum:string)=>{const form=new FormData();form.set("replaceId",id);form.set("expectedChecksum",checksum);form.set("file",new File(["Fictional replacement"],"replacement.txt",{type:"text/plain"}));return new Request("http://surveynt.test/api/v1/documents",{method:"POST",body:form});};
    expect((await upload(replace(original.id,"stale"))).status).toBe(409);expect(state.put).not.toHaveBeenCalled();
    const response=await upload(replace(original.id,original.checksum));expect(response.ok).toBe(true);const body=await response.json();
    const [previous]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,original.id));expect(previous.deletedAt).not.toBeNull();expect(previous.blobPathname).toBe("original");
    const [current]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,body.data.id));expect(current).toMatchObject({accessClass:"restricted",category:"compliance",retentionUntil:retainedUntil});expect(state.remove).not.toHaveBeenCalled();
    await db.update(organisationDocuments).set({legalHold:true}).where(eq(organisationDocuments.id,current.id));
    expect((await upload(replace(current.id,current.checksum))).status).toBe(409);expect(state.put).toHaveBeenCalledTimes(1);
  });
  it("protects report delivery originals and rejects references after removal begins",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner"});
    const [client]=await db.insert(clients).values({organisationId:orgId,kind:"individual",displayName:"Report reference client"}).returning();
    const [property]=await db.insert(properties).values({organisationId:orgId,clientId:client.id,line1:"3 Fictional Road",city:"Bristol",postcode:"BS1 1AA"}).returning();
    const [job]=await db.insert(jobs).values({organisationId:orgId,clientId:client.id,propertyId:property.id,reference:"REFERENCE-JOB",serviceName:"Fictional survey"}).returning();
    const id=crypto.randomUUID(),pendingId=crypto.randomUUID(),raceId=crypto.randomUUID();
    const originals=await db.insert(organisationDocuments).values([id,pendingId,raceId].map(documentId=>({id:documentId,organisationId:orgId,name:"Archived report evidence",category:"practice",blobUrl:"private://reference",blobPathname:`organisations/${orgId}/documents/${documentId}/original`,checksum:"reference-checksum",contentType:"text/plain",sizeBytes:1,deletedAt:new Date(),retentionUntil:new Date(Date.now()-60000)}))).returning();
    const delivery={organisationId:orgId,jobId:job.id,reportVersionId:crypto.randomUUID(),documentId:id,recipient:"fictional@example.test"};
    await db.insert(reportDeliveries).values(delivery);
    const review={expectedChecksum:originals[0].checksum,expectedUpdatedAt:originals[0].updatedAt.toISOString(),reason:"Fictional reviewed removal request",confirmed:true};
    expect((await requestRemoval(request("/api/v1/documents/id/removal","POST",review),{params:Promise.resolve({id})})).status).toBe(409);
    await expect(db.update(organisationDocuments).set({purgeStatus:"pending",purgeRequestedAt:new Date()}).where(eq(organisationDocuments.id,id))).rejects.toThrow();
    await db.update(organisationDocuments).set({purgeStatus:"pending",purgeRequestedAt:new Date()}).where(eq(organisationDocuments.id,pendingId));
    await expect(db.insert(reportDeliveries).values({...delivery,documentId:pendingId})).rejects.toThrow();
    await expect(db.insert(reportDeliveries).values({...delivery,organisationId:demoId})).rejects.toThrow();
    const racing=await Promise.allSettled([
      db.insert(reportDeliveries).values({...delivery,documentId:raceId}),
      db.update(organisationDocuments).set({purgeStatus:"pending",purgeRequestedAt:new Date()}).where(eq(organisationDocuments.id,raceId)),
    ]);
    expect(racing.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(racing.filter(result=>result.status==="rejected")).toHaveLength(1);
    const [raced]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,raceId));
    const references=await db.select().from(reportDeliveries).where(eq(reportDeliveries.documentId,raceId));
    expect(references.length).toBe(raced.purgeStatus==="retained"?1:0);
    expect(state.remove).not.toHaveBeenCalled();
  });
  it("preserves no-expiry retention and an unassigned job on replacement",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner"});
    const [original]=await db.insert(organisationDocuments).values({organisationId:orgId,name:"No expiry original",category:"compliance",accessClass:"restricted",blobUrl:"private://no-expiry",blobPathname:"no-expiry",checksum:"no-expiry-checksum",contentType:"text/plain",sizeBytes:1,retentionUntil:null,jobId:null}).returning();
    const [client]=await db.insert(clients).values({organisationId:orgId,kind:"individual",displayName:"Replacement association client"}).returning();
    const [property]=await db.insert(properties).values({organisationId:orgId,clientId:client.id,line1:"2 Fictional Road",city:"Bristol",postcode:"BS1 1AA"}).returning();
    const [job]=await db.insert(jobs).values({organisationId:orgId,clientId:client.id,propertyId:property.id,reference:"REPLACEMENT-JOB",serviceName:"Fictional survey"}).returning();
    const form=new FormData();form.set("jobId",job.id);form.set("replaceId",original.id);form.set("expectedChecksum",original.checksum);form.set("file",new File(["Fictional replacement"],"replacement.txt",{type:"text/plain"}));
    const response=await upload(new Request("http://surveynt.test/api/v1/documents",{method:"POST",body:form}));expect(response.status).toBe(200);
    const payload=await response.json();const [replacement]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,payload.data.id));
    expect(replacement).toMatchObject({retentionUntil:null,jobId:null,accessClass:"restricted",category:"compliance"});
    const [archived]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,original.id));expect(archived.retentionUntil).toBeNull();expect(archived.deletedAt).not.toBeNull();expect(state.remove).not.toHaveBeenCalled();
  });
  it("assigns upload access and rejects missing or foreign jobs before storage writes", async () => {
    Object.assign(state.context, { organisationId: orgId, role: "owner" });
    const [client] = await db.insert(clients).values({ organisationId: orgId, kind: "individual", displayName: "Fictional file client" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: orgId, clientId: client.id, line1: "1 Fictional Road", city: "Bristol", postcode: "BS1 1AA" }).returning();
    const [job] = await db.insert(jobs).values({ organisationId: orgId, clientId: client.id, propertyId: property.id, reference: "DOCUMENT-JOB", serviceName: "Fictional survey" }).returning();
    const submit = (accessClass: string, jobId?: string) => {
      const form = new FormData();
      form.set("file", new File(["Fictional job instructions"], "instructions.txt", { type: "text/plain" }));
      form.set("accessClass", accessClass);
      if (jobId) form.set("jobId", jobId);
      return upload(new Request("http://surveynt.test/api/v1/documents", { method: "POST", body: form }));
    };
    const writes = state.put.mock.calls.length;
    expect((await submit("unknown")).status).toBe(400);
    expect((await submit("job")).status).toBe(400);
    expect((await submit("job", crypto.randomUUID())).status).toBe(400);
    state.context.organisationId = demoId;
    expect((await submit("job", job.id)).status).toBe(400);
    state.context.organisationId = orgId;
    expect(state.put.mock.calls.length).toBe(writes);
    const response = await submit("job", job.id);
    expect(response.ok).toBe(true);
    const body = await response.json();
    const [document] = await db.select().from(organisationDocuments).where(eq(organisationDocuments.id, body.data.id));
    expect(document).toMatchObject({ jobId: job.id, accessClass: "job" });
    const restricted = await submit("restricted");
    const [privateDocument] = await db.select().from(organisationDocuments).where(eq(organisationDocuments.id, (await restricted.json()).data.id));
    expect(privateDocument.accessClass).toBe("restricted");
  });
  it("recovers archived originals with tenant, permission and checksum checks", async () => {
    Object.assign(state.context, { organisationId: orgId, role: "owner" });
    const retainedUntil = new Date(Date.now() + 86400000);
    const [document] = await db.insert(organisationDocuments).values({ organisationId: orgId, name: "Archived fixture", category: "legal", accessClass: "restricted", blobUrl: "private://recovery", blobPathname: "recovery", checksum: "recovery-checksum", contentType: "text/plain", sizeBytes: 1, deletedAt: new Date(), retentionUntil: retainedUntil, legalHold: true }).returning();
    const route = { params: Promise.resolve({ id: document.id }) };
    const body = { action: "restore", expectedChecksum: document.checksum };
    const list = await (await documentList(request("/api/v1/documents?archived=true"))).json();
    expect(list.data.some((row: {id: string}) => row.id === document.id)).toBe(true);
    state.context.role = "surveyor";
    expect((await documentList(request("/api/v1/documents?archived=true"))).status).toBe(403);
    expect((await restore(request("/api/v1/documents/id", "POST", body), route)).status).toBe(403);
    state.context.role = "owner";
    state.context.organisationId = demoId;
    expect((await restore(request("/api/v1/documents/id", "POST", body), route)).status).toBe(404);
    state.context.organisationId = orgId;
    expect((await restore(request("/api/v1/documents/id", "POST", { ...body, expectedChecksum: "stale" }), route)).status).toBe(409);
    const replies = await Promise.all([restore(request("/api/v1/documents/id", "POST", body), route), restore(request("/api/v1/documents/id", "POST", body), route)]);
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 404]);
    const [recovered] = await db.select().from(organisationDocuments).where(eq(organisationDocuments.id, document.id));
    expect(recovered).toMatchObject({ deletedAt: null, blobPathname: "recovery", checksum: document.checksum, legalHold: true, retentionUntil: retainedUntil });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId, document.id), eq(auditEvents.action, "document.restored")))).toHaveLength(1);
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("reviews archived retention with current protection, tenant and permission guards",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner"});const retainedUntil=new Date(Date.now()+86400000);
    const [document]=await db.insert(organisationDocuments).values({organisationId:orgId,name:"Archived retention fixture",category:"compliance",accessClass:"restricted",blobUrl:"private://retention",blobPathname:"retention",checksum:"retention-checksum",contentType:"text/plain",sizeBytes:1,deletedAt:new Date(),retentionUntil:retainedUntil,legalHold:true}).returning();
    const route={params:Promise.resolve({id:document.id})};
    const body={expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt.toISOString(),expectedLegalHold:true,expectedRetentionUntil:retainedUntil.toISOString(),retentionUntil:null,legalHold:false,reason:"Fictional reviewed protection decision",confirmed:true};
    const call=(values:unknown)=>reviewRetention(request(`/api/v1/documents/${document.id}/retention`,"PATCH",values),route);
    state.context.role="surveyor";expect((await call(body)).status).toBe(403);state.context.role="owner";
    state.context.organisationId=demoId;expect((await call(body)).status).toBe(404);state.context.organisationId=orgId;
    expect((await call({...body,confirmed:false})).status).toBe(400);expect((await call({...body,expectedChecksum:"stale"})).status).toBe(409);expect((await call({...body,expectedLegalHold:false})).status).toBe(409);
    const replies=await Promise.all([call(body),call(body)]);expect(replies.map(reply=>reply.status).sort()).toEqual([200,409]);
    const [current]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,document.id));expect(current).toMatchObject({legalHold:false,retentionUntil:null,blobPathname:"retention",checksum:document.checksum});expect(current.deletedAt).not.toBeNull();
    const audit=await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,document.id),eq(auditEvents.action,"document.retention_reviewed")));expect(audit).toHaveLength(1);expect(audit[0].metadata).toMatchObject({reason:body.reason,previous:{legalHold:true},next:{legalHold:false}});expect(state.remove).not.toHaveBeenCalled();
  });

  it("returns a job to instructed only when its final planned appointment is cancelled", async () => {
    Object.assign(state.context, { organisationId: orgId, role: "owner" });
    const [client] = await db.insert(clients).values({ organisationId: orgId, kind: "individual", displayName: "Fictional appointment client" }).returning();
    const [property] = await db.insert(properties).values({ organisationId: orgId, clientId: client.id, line1: "2 Fictional Road", city: "Bristol", postcode: "BS1 1AA" }).returning();
    const [job] = await db.insert(jobs).values({ organisationId: orgId, clientId: client.id, propertyId: property.id, reference: "CANCEL-JOB", serviceName: "Fictional survey", stage: "scheduled", targetDate: "2026-10-12", assignedSurveyorId: ownerId }).returning();
    const visits = await db.insert(appointments).values([12, 13].map(day => ({ organisationId: orgId, jobId: job.id, surveyorId: ownerId, status: "confirmed" as const, startsAt: new Date(`2026-10-${day}T09:00:00Z`), endsAt: new Date(`2026-10-${day}T10:00:00Z`) }))).returning();
    const cancel = (visit: typeof visits[number]) => manageAppointment(request("/api/v1/calendar/appointments", "POST", { id: visit.id, version: visit.version, jobId: job.id, surveyorId: ownerId, startsAt: visit.startsAt.toISOString(), durationMinutes: 60, cancel: true }));
    expect((await cancel(visits[0])).ok).toBe(true);
    let [updated] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(updated).toMatchObject({ stage: "scheduled", targetDate: "2026-10-13" });
    expect((await cancel(visits[1])).ok).toBe(true);
    [updated] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(updated).toMatchObject({ stage: "instructed", targetDate: null, assignedSurveyorId: ownerId });
    expect(await db.select().from(jobStageEvents).where(eq(jobStageEvents.jobId, job.id))).toHaveLength(1);
    expect((await cancel(visits[1])).status).toBe(409);
    const [completed] = await db.insert(appointments).values({ organisationId: orgId, jobId: job.id, surveyorId: ownerId, status: "completed", startsAt: new Date("2026-10-14T09:00:00Z"), endsAt: new Date("2026-10-14T10:00:00Z") }).returning();
    expect((await cancel(completed)).status).toBe(409);
  });

  it("saves reviewed practice email templates with tenant, role, validation and concurrency guards",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner",demo:false});
    const template={customer_quote_issued:{subject:"Quote {{quoteReference}}",introduction:"Hello {{customerName}}"}};
    const body={expected:{},templates:template,confirmed:true};
    const save=(input:unknown)=>saveTemplates(request("/api/v1/operations/email-templates","PATCH",input));
    state.context.role="surveyor";expect((await save(body)).status).toBe(403);state.context.role="owner";
    expect((await save({...body,confirmed:false})).status).toBe(400);
    expect((await save({...body,templates:{customer_quote_issued:{subject:"{{unknown}}",introduction:"Hello"}}})).status).toBe(400);
    const responses=await Promise.all([save(body),save(body)]);expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
    const [saved]=await db.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,orgId));expect(saved.emailTemplates).toEqual(template);
    state.context.organisationId=demoId;
    expect((await save({...body,expected:template,templates:{}})).status).toBe(409);
    expect((await db.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,orgId)))[0].emailTemplates).toEqual(template);
    state.context.organisationId=orgId;
    expect((await save({...body,expected:template,templates:{}})).status).toBe(200);
    const audits=await db.select().from(auditEvents).where(and(eq(auditEvents.organisationId,orgId),eq(auditEvents.action,"notification.templates_updated")));expect(audits).toHaveLength(2);expect(audits[0].actorUserId).toBe(ownerId);
  });

  it("durably queues reviewed expired originals and prevents restore or protection races",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner",demo:false});
    const documentId=crypto.randomUUID();
    const [document]=await db.insert(organisationDocuments).values({id:documentId,organisationId:orgId,name:"Expired original",category:"practice",blobUrl:"private://expired",blobPathname:`organisations/${orgId}/documents/${documentId}/original`,checksum:"review-checksum",contentType:"text/plain",sizeBytes:10,deletedAt:new Date(),retentionUntil:new Date(Date.now()-60000)}).returning();
    const route={params:Promise.resolve({id:document.id})};
    const body={expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt.toISOString(),reason:"Reviewed expired practice original",confirmed:true};
    const remove=(input:unknown)=>requestRemoval(request("/removal","POST",input),route);
    state.context.role="surveyor";expect((await remove(body)).status).toBe(403);state.context.role="owner";
    expect((await remove({...body,confirmed:false})).status).toBe(400);
    expect((await remove({...body,expectedChecksum:"changed"})).status).toBe(409);
    expect((await remove(body)).status).toBe(200);expect((await remove(body)).status).toBe(409);
    expect((await restore(request("/restore","POST",{action:"restore",expectedChecksum:document.checksum}),route)).status).toBe(409);
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,document.id)))[0].purgeStatus).toBe("pending");
    expect(state.remove).not.toHaveBeenCalled();
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,document.id),eq(auditEvents.action,"document.removal_requested")))).toHaveLength(1);
  });

  it("deletes only after a committed claim and recovers a lost storage response without repeat deletion",async()=>{
    const {createMemoryStorage}=await vi.importActual<typeof import("../src/lib/storage")>("../src/lib/storage");
    const storage=createMemoryStorage();
    const seed=async(label:string)=>{
      const id=crypto.randomUUID(),key=`organisations/${orgId}/documents/${id}/original`;
      void label;
      const [document]=await db.insert(organisationDocuments).values({id,organisationId:orgId,name:"Removal worker original",category:"practice",blobUrl:`private://${key}`,blobPathname:key,checksum:"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",contentType:"text/plain",sizeBytes:3,deletedAt:new Date(),retentionUntil:new Date(Date.now()-60000),purgeStatus:"pending",purgeRequestedAt:new Date()}).returning();
      const [job]=await db.insert(backgroundJobs).values({organisationId:orgId,queue:"document_removal",type:"remove_retained_original",payload:{documentId:document.id,checksum:document.checksum,blobPathname:key}}).returning();
      await storage.put(key,new TextEncoder().encode("abc").buffer,"text/plain");return {document,job};
    };
    // The earlier request test also queued an absent original: it must be held for review.
    const normal=await seed("worker-normal");
    const actualRemove=storage.remove;const remove=vi.fn(async(key:string)=>{
      const [current]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.blobPathname,key));expect(current.purgeStatus).toBe("removing");await actualRemove(key);
    });storage.remove=remove;
    await Promise.all([processDocumentRemovalQueue(10,{db,storage}),processDocumentRemovalQueue(10,{db,storage})]);
    expect(remove).toHaveBeenCalledTimes(1);expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,normal.document.id)))[0].purgeStatus).toBe("purged");
    const lost=await seed("worker-lost");storage.remove=vi.fn(async(key:string)=>{await actualRemove(key);throw new Error("Lost deletion response");});
    await processDocumentRemovalQueue(10,{db,storage});expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,lost.document.id)))[0].purgeStatus).toBe("removing");
    await db.update(backgroundJobs).set({lockedUntil:new Date(Date.now()-600000)}).where(eq(backgroundJobs.id,lost.job.id));
    await processDocumentRemovalQueue(10,{db,storage});expect(storage.remove).toHaveBeenCalledTimes(1);
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,lost.document.id)))[0].purgeStatus).toBe("purged");
    const altered=await seed("worker-altered");
    storage.objects.set(altered.document.blobPathname,{body:new TextEncoder().encode("xyz"),contentType:"text/plain"});
    const calls=vi.mocked(storage.remove).mock.calls.length;
    await processDocumentRemovalQueue(10,{db,storage});
    expect(vi.mocked(storage.remove).mock.calls.length).toBe(calls);
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,altered.document.id)))[0].purgeStatus).toBe("verification_required");
  });

  it("cancels only a reviewed pending request and permits a fresh request",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner",demo:false});
    const id=crypto.randomUUID();
    const [document]=await db.insert(organisationDocuments).values({id,organisationId:orgId,name:"Cancellation original",category:"practice",blobUrl:"private://cancel",blobPathname:`organisations/${orgId}/documents/${id}/original`,checksum:"cancel-checksum",contentType:"text/plain",sizeBytes:1,deletedAt:new Date(),retentionUntil:new Date(Date.now()-60000)}).returning();
    const route={params:Promise.resolve({id})};
    const body={expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt.toISOString(),reason:"Reviewed cancellation before storage deletion",confirmed:true};
    expect((await requestRemoval(request("/remove","POST",body),route)).status).toBe(200);
    const [pending]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,id));
    const reviewed={...body,expectedUpdatedAt:pending.updatedAt.toISOString()};
    expect((await cancelRemoval(request("/cancel","PATCH",body),route)).status).toBe(409);
    const responses=await Promise.all([cancelRemoval(request("/cancel","PATCH",reviewed),route),cancelRemoval(request("/cancel","PATCH",reviewed),route)]);
    expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
    const [retained]=await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,id));expect(retained.purgeStatus).toBe("retained");
    expect((await requestRemoval(request("/remove","POST",{...body,expectedUpdatedAt:retained.updatedAt.toISOString()}),route)).status).toBe(200);
    await db.update(backgroundJobs).set({status:"sending"}).where(eq(backgroundJobs.deduplicationKey,`document-removal:${id}`));
    expect((await cancelRemoval(request("/cancel","PATCH",reviewed),route)).status).toBe(409);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,id),eq(auditEvents.action,"document.removal_cancelled")))).toHaveLength(1);
  });

  it("moves a newly protected original and its removal job into review together",async()=>{
    const id=crypto.randomUUID();
    await db.insert(organisationDocuments).values({id,organisationId:orgId,name:"Newly protected original",category:"practice",blobUrl:"private://protected",blobPathname:`organisations/${orgId}/documents/${id}/original`,checksum:"protected-checksum",contentType:"text/plain",sizeBytes:1,deletedAt:new Date(),retentionUntil:new Date(Date.now()-60000),legalHold:true,purgeStatus:"pending"});
    const [job]=await db.insert(backgroundJobs).values({organisationId:orgId,queue:"document_removal",type:"remove_retained_original",payload:{documentId:id,checksum:"protected-checksum",blobPathname:`organisations/${orgId}/documents/${id}/original`}}).returning();
    const remove=vi.fn(),get=vi.fn();
    await processDocumentRemovalQueue(20,{db,storage:{name:"guard-test",get,remove,put:vi.fn()}});
    expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0].status).toBe("verification_required");
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,id)))[0].purgeStatus).toBe("verification_required");
    expect(remove).not.toHaveBeenCalled();
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,id),eq(auditEvents.action,"document.removal_verification_required")))).toHaveLength(1);
  });

  it("resolves reviewed storage incidents only with matching current evidence",async()=>{
    Object.assign(state.context,{organisationId:orgId,role:"owner",demo:false});
    const id=crypto.randomUUID(),key=`organisations/${orgId}/documents/${id}/original`;
    const [document]=await db.insert(organisationDocuments).values({id,organisationId:orgId,name:"Reviewed absent original",category:"practice",blobUrl:`private://${key}`,blobPathname:key,checksum:"reviewed-checksum",contentType:"text/plain",sizeBytes:1,deletedAt:new Date(),purgeStatus:"verification_required"}).returning();
    const [job]=await db.insert(backgroundJobs).values({organisationId:orgId,queue:"document_removal",type:"remove_retained_original",status:"verification_required",deduplicationKey:`document-removal:${id}`,attempts:1,leaseToken:crypto.randomUUID(),payload:{documentId:id,checksum:document.checksum,blobPathname:key}}).returning();
    const body={outcome:"confirm_absent",expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt.toISOString(),expectedAttempts:1,expectedLeaseToken:job.leaseToken,evidence:"Reviewed provider incident evidence; operations completed",providerOperationsSettled:true,confirmed:true};
    const route={params:Promise.resolve({id})};
    const review=(value:unknown)=>reviewRemoval(request("/review","POST",value),route);
    state.get.mockReset().mockResolvedValue(null);
    state.context.role="surveyor";expect((await review(body)).status).toBe(403);state.context.role="owner";
    expect((await review({...body,providerOperationsSettled:false})).status).toBe(400);
    expect((await review({...body,expectedAttempts:0})).status).toBe(409);
    expect((await review({...body,outcome:"keep_original"})).status).toBe(409);
    expect((await review(body)).status).toBe(200);expect((await review(body)).status).toBe(409);
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,id)))[0].purgeStatus).toBe("purged");
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,id),eq(auditEvents.action,"document.removal_reviewed")))).toHaveLength(1);
    expect(state.remove).not.toHaveBeenCalled();
    const keptId=crypto.randomUUID(),keptKey=`organisations/${orgId}/documents/${keptId}/original`;
    const [kept]=await db.insert(organisationDocuments).values({id:keptId,organisationId:orgId,name:"Verified retained original",category:"practice",blobUrl:`private://${keptKey}`,blobPathname:keptKey,checksum:"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",contentType:"text/plain",sizeBytes:3,deletedAt:new Date(),purgeStatus:"verification_required"}).returning();
    const [keptJob]=await db.insert(backgroundJobs).values({organisationId:orgId,queue:"document_removal",type:"remove_retained_original",status:"verification_required",deduplicationKey:`document-removal:${keptId}`,attempts:2,leaseToken:crypto.randomUUID(),payload:{documentId:keptId,checksum:kept.checksum,blobPathname:keptKey}}).returning();
    const keptBody={...body,expectedChecksum:kept.checksum,expectedUpdatedAt:kept.updatedAt.toISOString(),expectedAttempts:2,expectedLeaseToken:keptJob.leaseToken};
    const keptRoute={params:Promise.resolve({id:keptId})};
    const listed=await (await documentList(request("/api/v1/documents?archived=true"))).json();
    expect(listed.data.find((row:{id:string})=>row.id===keptId).removalReview.attempts).toBe(2);
    state.context.organisationId=demoId;expect((await reviewRemoval(request("/review","POST",keptBody),keptRoute)).status).toBe(404);state.context.organisationId=orgId;
    state.get.mockImplementation(async()=>({stream:new Blob(["abc"]).stream(),contentType:"text/plain"}));
    expect((await reviewRemoval(request("/review","POST",keptBody),keptRoute)).status).toBe(409);
    expect((await reviewRemoval(request("/review","POST",{...keptBody,outcome:"keep_original"}),keptRoute)).status).toBe(200);
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,keptId)))[0].purgeStatus).toBe("retained");
    expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,keptJob.id)))[0]).toMatchObject({status:"cancelled",deduplicationKey:null});
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("enforces removal identity and transition protection in the database",async()=>{
    const id=crypto.randomUUID();
    await db.insert(organisationDocuments).values({id,organisationId:orgId,name:"Immutable pending original",category:"practice",blobUrl:"private://guard",blobPathname:`organisations/${orgId}/documents/${id}/original`,checksum:"guard-checksum",contentType:"text/plain",sizeBytes:1,deletedAt:new Date(),purgeStatus:"pending"});
    for(const values of [{deletedAt:null},{checksum:"replacement"},{blobPathname:"another-object"},{legalHold:true},{purgeStatus:"purged",purgedAt:new Date()}]) {
      await expect(db.update(organisationDocuments).set(values).where(eq(organisationDocuments.id,id))).rejects.toThrow();
    }
    await expect(db.delete(organisationDocuments).where(eq(organisationDocuments.id,id))).rejects.toThrow();
    await db.update(organisationDocuments).set({purgeStatus:"removing"}).where(eq(organisationDocuments.id,id));
    await db.update(organisationDocuments).set({purgeStatus:"purged",purgedAt:new Date()}).where(eq(organisationDocuments.id,id));
    await expect(db.update(organisationDocuments).set({purgeStatus:"retained",purgedAt:null}).where(eq(organisationDocuments.id,id))).rejects.toThrow();
    await expect(db.update(organisationDocuments).set({purgedAt:new Date(Date.now()+60000)}).where(eq(organisationDocuments.id,id))).rejects.toThrow();
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,id)))[0].purgeStatus).toBe("purged");
  });

  it("quarantines unsupported removal jobs and reports held originals",async()=>{
    const id=crypto.randomUUID(),key=`organisations/${orgId}/documents/${id}/original`;
    await db.insert(organisationDocuments).values({id,organisationId:orgId,name:"Unsupported removal",category:"practice",blobUrl:`private://${key}`,blobPathname:key,checksum:"unsupported-checksum",contentType:"text/plain",sizeBytes:1,deletedAt:new Date(),retentionUntil:new Date(Date.now()-60000),purgeStatus:"pending"});
    const [job]=await db.insert(backgroundJobs).values({organisationId:orgId,queue:"document_removal",type:"historical_unsupported",deduplicationKey:`document-removal:${id}`,payload:{documentId:id,checksum:"unsupported-checksum",blobPathname:key}}).returning();
    const remove=vi.fn(),get=vi.fn();
    const result=await processDocumentRemovalQueue(20,{db,storage:{name:"unsupported-guard",get,remove,put:vi.fn()}});
    expect(result.review).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0].status).toBe("verification_required");
    expect((await db.select().from(organisationDocuments).where(eq(organisationDocuments.id,id)))[0].purgeStatus).toBe("verification_required");
    expect(remove).not.toHaveBeenCalled();
  });

});
