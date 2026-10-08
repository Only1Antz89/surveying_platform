import { createHash } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents,clientPayments,customerQuotes,organisationMemberships,organisationOperationalSettings,organisations,users,type Database } from "@surveynt/db";
import { createTestDatabase,integrationEnabled,stopRelay,type TestDatabase } from "@surveynt/db/testing";
const state=vi.hoisted(()=>({retrieve:vi.fn(),expire:vi.fn(),create:vi.fn(),context:{organisationId:"",internalUserId:"",userId:"resolution-owner",role:"owner",demo:false,accessLevel:"full"},writable:true}));
vi.mock("server-only",()=>({}));
vi.mock("../src/lib/access",()=>({apiContext:async()=>state.context,canWriteWorkspace:()=>state.writable}));
vi.mock("stripe",()=>({default:class{checkout={sessions:{retrieve:state.retrieve,expire:state.expire,create:state.create}}}}));
import { POST as resolve } from "../src/app/api/v1/finance/payments/[id]/resolve-checkout/route";
import { POST as publicCheckout } from "../src/app/api/v1/public/quotes/[id]/checkout/route";
import { POST as manualDeposit } from "../src/app/api/v1/quotes/[id]/manual-deposit/route";
import { createPendingDeposit } from "../src/lib/firm-operations";

describe.skipIf(!integrationEnabled)("verified pending Checkout resolution",()=>{
  let database:TestDatabase,db:Database,orgId:string,otherId:string;
  const route=(id:string)=>({params:Promise.resolve({id})});
  const request=(sessionId:string)=>new Request("http://surveynt.test/resolve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedSessionId:sessionId,reason:"Reviewed fictional unpaid Checkout",confirmed:true})});
  async function fixture(){
    const key=crypto.randomUUID(),token=`resolution-${key}`;
    const [quote]=await db.insert(customerQuotes).values({organisationId:orgId,reference:`SVQ-${key}`,status:"accepted",acceptedAt:new Date(),propertyAddress:"1 Fictional Road, Bristol, BS1 1AA",city:"Bristol",postcode:"BS1 1AA",subtotalMinor:10000,vatMinor:0,totalMinor:10000,depositMinor:1000,expiresAt:new Date(Date.now()+86400000),accessTokenHash:createHash("sha256").update(token).digest("hex")}).returning();
    const {payment}=await createPendingDeposit(quote);const sessionId=`cs_${key}`;
    await db.update(clientPayments).set({stripeCheckoutSessionId:sessionId}).where(eq(clientPayments.id,payment.id));
    const session={id:sessionId,status:"open",mode:"payment",payment_status:"unpaid",amount_total:1000,currency:"gbp",metadata:{surveyntPaymentId:payment.id,surveyntOrganisationId:orgId,surveyntQuoteId:quote.id,surveyntPaymentKind:"client_deposit"}};
    return{quote,payment,session,token};
  }
  beforeAll(async()=>{
    database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("DATABASE_APP_URL",database.appUrl);vi.stubEnv("STRIPE_CLIENT_PAYMENTS_KEY","sk_test_local");vi.stubEnv("CLIENT_PAYMENTS_LAUNCH_APPROVED","true");
    const rows=await db.insert(organisations).values([{clerkOrganisationId:"checkout-resolution",slug:"checkout-resolution",name:"Resolution practice",practiceType:"building_surveying",region:"Bristol",status:"active"},{clerkOrganisationId:"resolution-other",slug:"resolution-other",name:"Other practice",practiceType:"building_surveying",region:"Bristol",status:"active"}]).returning();orgId=rows[0].id;otherId=rows[1].id;
    const [owner]=await db.insert(users).values({clerkUserId:"resolution-owner",email:"resolution-owner@example.test"}).returning();await db.insert(organisationMemberships).values({organisationId:orgId,userId:owner.id,role:"owner",active:true});Object.assign(state.context,{organisationId:orgId,internalUserId:owner.id});
    await db.insert(organisationOperationalSettings).values({organisationId:orgId,clientPaymentsEnabled:true});
  },120000);
  afterAll(async()=>{vi.unstubAllEnvs();await database?.drop();await stopRelay();});
  it("expires only a matching unpaid Checkout and permits an evidence-backed external deposit",async()=>{
    const f=await fixture();state.retrieve.mockResolvedValue(f.session);state.expire.mockResolvedValue({...f.session,status:"expired"});
    const response=await resolve(request(f.session.id),route(f.payment.id));expect(response.status).toBe(200);expect((await response.json()).meta.fundsTransferred).toBe(false);
    const [stored]=await db.select().from(clientPayments).where(eq(clientPayments.id,f.payment.id));expect(stored.status).toBe("failed");
    expect((await resolve(request(f.session.id),route(f.payment.id))).status).toBe(200);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,f.payment.id))).toHaveLength(1);
    const body={requestId:crypto.randomUUID(),version:f.quote.version,amountMinor:1000,expectedOutstandingMinor:1000,method:"bank_transfer",reference:"BANK-RESOLVED",evidence:"Reviewed fictional cleared bank receipt",occurredAt:new Date(Date.now()-60000).toISOString(),confirmed:true};
    const receipt=new Request("http://surveynt.test/deposit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});expect((await manualDeposit(receipt,route(f.quote.id))).ok).toBe(true);
  });
  it("accepts an already expired provider session without calling expire again",async()=>{
    const f=await fixture();state.expire.mockClear();state.retrieve.mockResolvedValue({...f.session,status:"expired"});expect((await resolve(request(f.session.id),route(f.payment.id))).ok).toBe(true);expect(state.expire).not.toHaveBeenCalled();
  });
  it("preserves completed, mismatched and unconfirmed provider sessions",async()=>{
    const f=await fixture();
    for(const session of [{...f.session,status:"complete",payment_status:"paid"},{...f.session,amount_total:999},{...f.session,currency:"usd"},{...f.session,metadata:{...f.session.metadata,surveyntOrganisationId:otherId}}]){state.retrieve.mockResolvedValue(session);expect((await resolve(request(f.session.id),route(f.payment.id))).status).toBe(409);}
    state.retrieve.mockResolvedValue(f.session);state.expire.mockResolvedValue(f.session);expect((await resolve(request(f.session.id),route(f.payment.id))).status).toBe(409);
    state.expire.mockRejectedValue(new Error("Transient provider failure"));expect((await resolve(request(f.session.id),route(f.payment.id))).status).toBe(503);
    const [stored]=await db.select().from(clientPayments).where(eq(clientPayments.id,f.payment.id));expect(stored.status).toBe("pending");expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,f.payment.id))).toHaveLength(0);
  });
  it("rejects foreign records, restricted reviewers and stale session identities",async()=>{
    const f=await fixture();state.retrieve.mockClear();state.context.organisationId=otherId;expect((await resolve(request(f.session.id),route(f.payment.id))).status).toBe(404);state.context.organisationId=orgId;
    state.context.role="surveyor";expect((await resolve(request(f.session.id),route(f.payment.id))).status).toBe(403);state.context.role="owner";
    state.writable=false;expect((await resolve(request(f.session.id),route(f.payment.id))).status).toBe(403);state.writable=true;
    expect((await resolve(request("cs_stale"),route(f.payment.id))).status).toBe(409);expect(state.retrieve).not.toHaveBeenCalled();
  });
  it("serialises customer session replacement against finance resolution",async()=>{
    const f=await fixture();state.retrieve.mockResolvedValue({...f.session,status:"expired"});
    let release!:(value:unknown)=>void,started!:()=>void;
    const entered=new Promise<void>(r=>{started=r;});state.create.mockImplementation(()=>{started();return new Promise(r=>{release=r;});});
    const customer=new Request(`http://surveynt.test/api/v1/public/quotes/${f.quote.id}/checkout`,{method:"POST",headers:{"content-type":"application/json","x-quote-token":f.token},body:"{}"});
    const renewing=publicCheckout(customer,route(f.quote.id));await entered;
    const resolving=resolve(request(f.session.id),route(f.payment.id));
    release({...f.session,id:"cs_new_replacement",url:"https://checkout.stripe.test/new"});expect((await renewing).ok).toBe(true);expect((await resolving).status).toBe(409);
    const [stored]=await db.select().from(clientPayments).where(eq(clientPayments.id,f.payment.id));expect(stored).toMatchObject({status:"pending",stripeCheckoutSessionId:"cs_new_replacement"});
  });
});
