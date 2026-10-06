import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { availabilityBlocks, calendarConflicts, calendarConnections, clientPayments, createDatabase, invoices, organisationDocuments, organisationMemberships, organisationOperationalSettings, organisations, settlementLedger, users, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { syncSourceRegistry } from "@surveynt/property-data/importers";
import Stripe from "stripe";
vi.mock("server-only", () => ({}));

const state=vi.hoisted(()=>({context:{organisationId:"",internalUserId:"",userId:"user_api_owner",role:"owner",demo:false,accessLevel:"full"},remove:vi.fn(),get:vi.fn(),put:vi.fn(async()=>undefined)}));
vi.mock("../src/lib/access",()=>({apiContext:async()=>state.context,canWriteWorkspace:()=>true,isClerkConfigured:()=>false}));
vi.mock("../src/lib/storage",()=>({getObjectStorage:()=>({remove:state.remove,get:state.get,put:state.put}),maxUploadBytes:()=>10000}));
import { GET as capabilities } from "../src/app/api/v1/capabilities/route";
import { GET as demoCatalogue, POST as demoAction } from "../src/app/api/v1/demo/route";
import { GET as download, DELETE as archive, PATCH as protection } from "../src/app/api/v1/documents/[id]/route";
import { POST as createInvoice } from "../src/app/api/v1/finance/invoices/route";
import { GET as invoiceDetail, POST as invoiceAction } from "../src/app/api/v1/finance/invoices/[id]/route";
import { GET as availability } from "../src/app/api/v1/calendar/availability/route";
import { POST as settlement } from "../src/app/api/v1/finance/settlements/route";
import { POST as upload } from "../src/app/api/v1/documents/route";
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
});
