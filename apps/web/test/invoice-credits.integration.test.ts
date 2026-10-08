import { createHash } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents,clientPayments,clients,customerQuotes,invoiceCredits,invoices,jobs,organisationMemberships,organisations,properties,users,withTenant,type Database } from "@surveynt/db";
import { createTestDatabase,integrationEnabled,stopRelay,type TestDatabase } from "@surveynt/db/testing";
const state=vi.hoisted(()=>({context:{organisationId:"",internalUserId:"",userId:"credit-owner",role:"owner",demo:false,accessLevel:"full"},writable:true}));
vi.mock("server-only",()=>({}));
vi.mock("../src/lib/access",()=>({apiContext:async()=>state.context,canWriteWorkspace:()=>state.writable}));
import { POST as issueCredit } from "../src/app/api/v1/finance/invoices/[id]/credits/route";
import { GET as detail,POST as invoiceAction } from "../src/app/api/v1/finance/invoices/[id]/route";
import { GET as exportFinance } from "../src/app/api/v1/finance/exports/route";
import { POST as manualReceipt } from "../src/app/api/v1/finance/invoices/[id]/manual-payments/route";
import { createPendingBalance,listFirmOperations,readPublicQuote,settleBalancePayment } from "../src/lib/firm-operations";
import { practiceInsights } from "../src/lib/insights";

describe.skipIf(!integrationEnabled)("immutable invoice credits",()=>{
  let database:TestDatabase,db:Database,orgId:string,otherId:string,invoiceId:string,ownerId:string;
  const route=(id:string)=>({params:Promise.resolve({id})});
  const request=(path:string,body?:unknown)=>new Request(`http://surveynt.test${path}`,body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{});
  const credit=(amountMinor=240,vatMinor=40,expectedCreditedMinor=0)=>({requestId:crypto.randomUUID(),amountMinor,vatMinor,expectedCreditedMinor,reason:"Reviewed fictional fee adjustment",evidence:"Fictional invoice and adjustment approval",confirmed:true});
  beforeAll(async()=>{
    database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("DATABASE_APP_URL",database.appUrl);
    const practices=await db.insert(organisations).values([{clerkOrganisationId:"credit-practice",slug:"credits",name:"Credit practice",practiceType:"building_surveying",region:"Bristol",status:"active"},{clerkOrganisationId:"credit-other",slug:"credit-other",name:"Other practice",practiceType:"building_surveying",region:"Bristol",status:"active"}]).returning();orgId=practices[0].id;otherId=practices[1].id;
    const [owner]=await db.insert(users).values({clerkUserId:"credit-owner",email:"credit-owner@example.test"}).returning();ownerId=owner.id;
    await db.insert(organisationMemberships).values({organisationId:orgId,userId:ownerId,role:"owner",active:true});Object.assign(state.context,{organisationId:orgId,internalUserId:ownerId});
    const [invoice]=await db.insert(invoices).values({organisationId:orgId,number:"CREDIT-ORIGINAL",status:"open",subtotalMinor:1000,vatMinor:200,totalMinor:1200,issuedAt:new Date()}).returning();invoiceId=invoice.id;
  },120000);
  afterAll(async()=>{vi.unstubAllEnvs();await database?.drop();await stopRelay();});
  it("issues one immutable credit and preserves original invoice amounts",async()=>{
    const body=credit();
    const responses=await Promise.all([issueCredit(request("/api/v1/finance/invoices/id/credits",body),route(invoiceId)),issueCredit(request("/api/v1/finance/invoices/id/credits",body),route(invoiceId))]);
    expect(responses.every(r=>r.ok)).toBe(true);const values=await Promise.all(responses.map(r=>r.json()));expect(values[0].data.id).toBe(values[1].data.id);
    const [stored]=await db.select().from(invoices).where(eq(invoices.id,invoiceId));expect(stored).toMatchObject({subtotalMinor:1000,vatMinor:200,totalMinor:1200,status:"open"});
    const result=await (await detail(request("/api/v1/finance/invoices/id"),route(invoiceId))).json();expect(result.data).toMatchObject({creditedMinor:240,creditedVatMinor:40,adjustedTotalMinor:960,outstandingMinor:960,overpaidMinor:0});
    expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",{...body,amountMinor:120}),route(invoiceId))).status).toBe(409);
    expect((await invoiceAction(request("/api/v1/finance/invoices/id",{action:"void"}),route(invoiceId))).status).toBe(409);
    const rows=await db.select().from(invoiceCredits);expect(rows).toHaveLength(1);
    await expect(db.update(invoiceCredits).set({reason:"changed"}).where(eq(invoiceCredits.id,rows[0].id))).rejects.toThrow();await expect(db.delete(invoiceCredits).where(eq(invoiceCredits.id,rows[0].id))).rejects.toThrow();
    const app=database.connect(database.appUrl);expect(await withTenant(app,otherId,tx=>tx.select().from(invoiceCredits))).toHaveLength(0);
    await expect(withTenant(app,otherId,tx=>tx.insert(invoiceCredits).values({...rows[0],id:crypto.randomUUID(),organisationId:otherId,requestId:crypto.randomUUID(),number:"FOREIGN"}))).rejects.toThrow();
  });
  it("rejects excessive VAT/net amounts, stale totals, foreign records and restricted access",async()=>{
    for(const body of [credit(1000,160,240),credit(200,161,240),credit(900,0,240),credit(120,20,0)])expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",body),route(invoiceId))).status).toBe(409);
    state.context.organisationId=otherId;expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",credit()),route(invoiceId))).status).toBe(404);state.context.organisationId=orgId;
    state.context.role="surveyor";expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",credit()),route(invoiceId))).status).toBe(403);state.context.role="owner";
    state.writable=false;expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",credit()),route(invoiceId))).status).toBe(403);state.writable=true;
    expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",{...credit(),confirmed:false}),route(invoiceId))).status).toBe(400);
  });
  it("serialises competing credits and exposes credits in reports and exports",async()=>{
    const responses=await Promise.all([issueCredit(request("/api/v1/finance/invoices/id/credits",credit(120,20,240)),route(invoiceId)),issueCredit(request("/api/v1/finance/invoices/id/credits",credit(120,20,240)),route(invoiceId))]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const operations=await listFirmOperations(orgId,{role:"owner",userId:ownerId});expect(operations.finance.find(r=>r.invoice.id===invoiceId)).toMatchObject({creditedMinor:360,outstandingMinor:840});
    const insights=await practiceInsights(orgId,new Date(Date.now()-86400000),new Date(Date.now()+86400000));expect(insights.money.find(r=>r.currency==="GBP")).toMatchObject({billedMinor:1200,creditedMinor:360,outstandingMinor:840});
    const invoiceCsv=await (await exportFinance(request("/api/v1/finance/exports?dataset=invoices"))).text();expect(invoiceCsv).toContain('"1000","200","1200","360","840","0","840"');
    const csv=await (await exportFinance(request("/api/v1/finance/exports?dataset=credits"))).text();expect(csv).toContain("CREDIT-ORIGINAL");expect(csv.trim().split("\r\n")).toHaveLength(3);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action,"invoice.credit_issued"))).toHaveLength(2);
  });
  it("leaves an overpayment for explicit refund review instead of sending funds",async()=>{
    const [invoice]=await db.insert(invoices).values({organisationId:orgId,number:"PAID-CREDIT",status:"paid",subtotalMinor:1000,vatMinor:0,totalMinor:1000,paidAt:new Date(),issuedAt:new Date()}).returning();
    await db.insert(clientPayments).values({organisationId:orgId,invoiceId:invoice.id,purpose:"balance",amountMinor:1000,status:"succeeded",succeededAt:new Date(),stripePaymentIntentId:"pi_credit_fixture"});
    const response=await issueCredit(request("/api/v1/finance/invoices/id/credits",credit(1000,0)),route(invoice.id));expect((await response.json()).meta).toMatchObject({fundsTransferred:false,refundRequiredMinor:1000});
    const result=await (await detail(request("/api/v1/finance/invoices/id"),route(invoice.id))).json();expect(result.data).toMatchObject({adjustedTotalMinor:0,outstandingMinor:0,overpaidMinor:1000,receivedMinor:1000});
  });
  it("collects only the remaining credited quote balance after a verified manual receipt",async()=>{
    const [client]=await db.insert(clients).values({organisationId:orgId,kind:"individual",displayName:"Fictional quote client"}).returning();const [property]=await db.insert(properties).values({organisationId:orgId,clientId:client.id,line1:"1 Fictional Street",city:"Bristol",postcode:"BS1 1AA"}).returning();const [job]=await db.insert(jobs).values({organisationId:orgId,clientId:client.id,propertyId:property.id,reference:"SVJ-CREDIT-QUOTE",serviceName:"Fictional survey",stage:"issued"}).returning();
    const token="local-credit-test-token";
    const [quote]=await db.insert(customerQuotes).values({organisationId:orgId,reference:"SVQ-CREDIT-QUOTE",status:"converted",subtotalMinor:10000,vatMinor:0,totalMinor:10000,depositMinor:1000,jobId:job.id,expiresAt:new Date(Date.now()+86400000),accessTokenHash:createHash("sha256").update(token).digest("hex")}).returning();
    const [invoice]=await db.insert(invoices).values({organisationId:orgId,quoteId:quote.id,jobId:job.id,number:"SVQ-CREDIT-QUOTE-B",status:"open",subtotalMinor:9000,vatMinor:0,totalMinor:9000,issuedAt:new Date()}).returning();
    expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",credit(1000,0)),route(invoice.id))).ok).toBe(true);
    const body={requestId:crypto.randomUUID(),amountMinor:2000,expectedOutstandingMinor:8000,method:"bank_transfer",reference:"BANK-CREDIT-QUOTE",evidence:"Checked fictional settled transfer",occurredAt:new Date(Date.now()-60000).toISOString(),confirmed:true};
    expect((await manualReceipt(request("/api/v1/finance/invoices/id/manual-payments",body),route(invoice.id))).ok).toBe(true);
    const found=await readPublicQuote(quote.id,token);expect(found?.view.balanceMinor).toBe(6000);
    const pending=await createPendingBalance(quote);expect(pending.payment.amountMinor).toBe(6000);
    expect((await issueCredit(request("/api/v1/finance/invoices/id/credits",credit(100,0,1000)),route(invoice.id))).status).toBe(409);
    await settleBalancePayment({paymentId:pending.payment.id,checkoutSessionId:"cs_credit_remaining",paymentIntentId:"pi_credit_remaining"});
    const result=await (await detail(request("/api/v1/finance/invoices/id"),route(invoice.id))).json();expect(result.data).toMatchObject({receivedMinor:8000,creditedMinor:1000,outstandingMinor:0});expect(result.data.invoice.status).toBe("paid");
    expect((await readPublicQuote(quote.id,token))?.view.balancePaid).toBe(true);
    expect(await (await exportFinance(request("/api/v1/finance/exports?dataset=invoices"))).text()).toContain('"9000","1000","8000","8000","0"');
  });
});
