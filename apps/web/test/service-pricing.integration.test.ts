import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { eq } from "drizzle-orm";
import { customerQuotes,organisationMemberships,organisations,servicePricingVersions,users,type Database } from "@surveynt/db";
import { createTestDatabase,integrationEnabled,stopRelay,type TestDatabase } from "@surveynt/db/testing";
const state=vi.hoisted(()=>({context:{organisationId:"",internalUserId:"",userId:"pricing-owner",role:"owner",demo:false,accessLevel:"full"},writable:true}));
vi.mock("server-only",()=>({}));
vi.mock("../src/lib/access",()=>({apiContext:async()=>state.context,canWriteWorkspace:()=>state.writable}));
import { GET as catalogue,POST as create } from "../src/app/api/v1/service-catalogue/route";
import { PATCH as update,DELETE as archive } from "../src/app/api/v1/service-catalogue/[id]/route";
import { createPublicQuote } from "../src/lib/firm-operations";
describe.skipIf(!integrationEnabled)("editable versioned service surcharges",()=>{
  let database:TestDatabase,db:Database,orgId:string,otherId:string,serviceId:string;
  const pricing={name:"Fictional condition survey",baseAmountMinor:45000,vatBasisPoints:2000,depositBasisPoints:1000,durationMinutes:180,validityDays:7,active:true,surcharges:{"loft-conversion":{label:"Loft conversion",amountMinor:10000}},recommendationRules:{}};
  const request=(body?:unknown)=>new Request("http://surveynt.test/api/v1/service-catalogue",body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{});
  const route=()=>({params:Promise.resolve({id:serviceId})});
  beforeAll(async()=>{
    database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_APP_URL",database.appUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("QUOTE_TOKEN_SECRET","local-pricing-regression");
    const rows=await db.insert(organisations).values([{clerkOrganisationId:"pricing-test",slug:"pricing-test",name:"Pricing practice",practiceType:"building_surveying",region:"Bristol",status:"active"},{clerkOrganisationId:"pricing-other",slug:"pricing-other",name:"Other practice",practiceType:"building_surveying",region:"Bristol",status:"active"}]).returning();orgId=rows[0].id;otherId=rows[1].id;
    const [owner]=await db.insert(users).values({clerkUserId:"pricing-owner",email:"pricing-owner@example.test"}).returning();await db.insert(organisationMemberships).values({organisationId:orgId,userId:owner.id,role:"owner",active:true});Object.assign(state.context,{organisationId:orgId,internalUserId:owner.id});
  },120000);
  afterAll(async()=>{vi.unstubAllEnvs();await database?.drop();await stopRelay();});
  it("applies configured surcharges and preserves old quote pricing after publication",async()=>{
    const response=await create(request(pricing));expect(response.ok).toBe(true);serviceId=(await response.json()).data.service.id;
    const first=await createPublicQuote({organisationId:orgId,actorUserId:state.context.internalUserId,requestId:crypto.randomUUID(),serviceId,email:"fictional@example.test",surchargeKeys:["loft-conversion"]});expect(first.quote).toMatchObject({subtotalMinor:55000,vatMinor:11000,totalMinor:66000,depositMinor:6600});
    expect((await update(request({...pricing,expectedVersion:1,surcharges:{"loft-conversion":{label:"Loft conversion",amountMinor:20000}}}),route())).ok).toBe(true);
    const second=await createPublicQuote({organisationId:orgId,actorUserId:state.context.internalUserId,requestId:crypto.randomUUID(),serviceId,email:"fictional@example.test",surchargeKeys:["loft-conversion"]});expect(second.quote.totalMinor).toBe(78000);
    const [original]=await db.select().from(customerQuotes).where(eq(customerQuotes.id,first.quote.id));expect(original.totalMinor).toBe(66000);expect(original.pricingSnapshot.surcharges).toEqual(pricing.surcharges);
  });
  it("allows only one publication from a shared reviewed version",async()=>{
    const body={...pricing,expectedVersion:2};const responses=await Promise.all([update(request(body),route()),update(request(body),route())]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);expect(await db.select().from(servicePricingVersions).where(eq(servicePricingVersions.serviceDefinitionId,serviceId))).toHaveLength(3);
    expect((await update(request({...pricing}),route())).status).toBe(400);
  });
  it("returns inactive latest pricing for editing and can reactivate it",async()=>{
    expect((await update(request({...pricing,expectedVersion:3,active:false}),route())).ok).toBe(true);
    const entries=(await (await catalogue(request())).json()).data;expect(entries.find((entry:{service:{id:string}})=>entry.service.id===serviceId)).toMatchObject({service:{active:false},pricing:{version:4,active:false}});
    expect((await update(request({...pricing,expectedVersion:4}),route())).ok).toBe(true);
  });
  it("archives as a new version so earlier editors cannot reactivate stale pricing",async()=>{
    expect((await archive(request({expectedVersion:5}),route())).ok).toBe(true);
    expect((await update(request({...pricing,expectedVersion:5}),route())).status).toBe(409);
    const entries=(await (await catalogue(request())).json()).data;expect(entries.find((entry:{service:{id:string}})=>entry.service.id===serviceId).pricing.version).toBe(6);
    expect((await archive(request({expectedVersion:5}),route())).ok).toBe(true);
    expect((await update(request({...pricing,expectedVersion:6}),route())).ok).toBe(true);
  });
  it("rejects foreign services, restricted roles and invalid price totals",async()=>{
    state.context.organisationId=otherId;expect((await update(request({...pricing,expectedVersion:7}),route())).status).toBe(404);state.context.organisationId=orgId;
    state.context.role="surveyor";expect((await update(request({...pricing,expectedVersion:7}),route())).status).toBe(403);state.context.role="owner";
    state.writable=false;expect((await create(request(pricing))).status).toBe(402);state.writable=true;
    expect((await update(request({...pricing,expectedVersion:7,surcharges:{loft:{label:"Fee",amountMinor:100000000}}}),route())).status).toBe(400);
  });
  it("publishes per-service recommendation eligibility and preserves prior quote versions",async()=>{
    expect((await create(request({...pricing,name:"RICS Level 1 Survey",recommendationRules:{source:"clifton_adviser_v1"}}))).ok).toBe(true);
    const created=await create(request({...pricing,name:"RICS Level 3 Survey"}));expect(created.ok).toBe(true);const id=(await created.json()).data.service.id;
    const quoteInput={organisationId:orgId,actorUserId:state.context.internalUserId,email:"fictional@example.test",answers:{propertyAge:"pre-1950"}};
    await expect(createPublicQuote({...quoteInput,requestId:crypto.randomUUID()})).rejects.toThrow("SERVICE_UNAVAILABLE");
    const target={params:Promise.resolve({id})};
    expect((await update(request({...pricing,name:"RICS Level 3 Survey",expectedVersion:1,recommendationRules:{source:"clifton_adviser_v1"}}),target)).ok).toBe(true);
    const quote=await createPublicQuote({...quoteInput,requestId:crypto.randomUUID()});const [record]=await db.select().from(customerQuotes).where(eq(customerQuotes.id,quote.quote.id));expect(record.serviceDefinitionId).toBe(id);expect(record.pricingSnapshot.pricingVersion).toBe(2);
    expect((await update(request({...pricing,name:"RICS Level 3 Survey",expectedVersion:2,recommendationRules:{}}),target)).ok).toBe(true);
    await expect(createPublicQuote({...quoteInput,requestId:crypto.randomUUID()})).rejects.toThrow("SERVICE_UNAVAILABLE");
    const [retained]=await db.select().from(customerQuotes).where(eq(customerQuotes.id,quote.quote.id));expect(retained.pricingVersionId).toBe(record.pricingVersionId);expect(retained.pricingSnapshot).toEqual(record.pricingSnapshot);
  });

});
