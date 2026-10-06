import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { clientPayments, invoices, jobs, organisations, organisationMemberships, users, withTenant, createDatabase } from "@surveynt/db";
import { isFieldRequired, listFields, residentialTemplateV1, type FieldDefinition, type FieldValue, type SyncOperation } from "@surveynt/assistant";
import { syncSourceRegistry } from "@surveynt/property-data/importers";
import { seedStakeholderDemo } from "../src/lib/stakeholder-demo";
import { acceptQuoteAddress, createPublicQuote, readPublicQuote } from "../src/lib/firm-operations";
import { createSurvey, applySyncOperations, type SurveyContext } from "../src/lib/surveys";
import { composeSurveyReport, approveReportVersion } from "../src/lib/reports";
import { enforceStageGate } from "../src/lib/completion";
import { POST as checkout } from "../src/app/api/v1/public/quotes/[id]/checkout/route";
import { GET as slots, POST as book } from "../src/app/api/v1/public/quotes/[id]/appointments/route";
import { GET as reports } from "../src/app/api/v1/public/quotes/[id]/reports/route";

function sample(field: FieldDefinition): FieldValue {
  switch(field.type){
    case "enum": return {state:"provided",value:["listed_status","conservation_area"].includes(field.key)?"no_record_found":field.options![0].value};
    case "integer": case "decimal": return {state:"provided",value:field.min??1};
    case "boolean": return {state:"provided",value:false};
    case "date": return {state:"provided",value:new Date().toISOString().slice(0,10)};
    default: return {state:"provided",value:`Fictional demonstration: ${field.key.replaceAll("_"," ")}.`};
  }
}
function inspectionFixture(): SyncOperation[] {
  const operations:SyncOperation[]=[];let count=0;const op=()=>`op_demo_journey_${String(++count).padStart(6,"0")}`;
  for(const section of residentialTemplateV1.sections)for(const element of section.elements)if(element.inspectable)operations.push({type:"set_element",operationId:op(),element:{sectionKey:section.key,elementKey:element.key,locationLabel:""},inspectionStatus:section.key==="outside"&&element.key==="roof_coverings"?"inspected":"not_applicable",limitationReason:null,baseVersion:null});
  for(const resolved of listFields(residentialTemplateV1))if(!resolved.element.inspectable&&isFieldRequired(resolved.field,{serviceLevel:"level_1"}))operations.push({type:"set_field",operationId:op(),fieldPath:resolved.path,value:sample(resolved.field),baseValueId:null});
  operations.push({type:"set_field",operationId:op(),fieldPath:"outside.roof_coverings.condition_rating",value:{state:"provided",value:"2"},baseValueId:null},{type:"set_field",operationId:op(),fieldPath:"outside.roof_coverings.construction",value:{state:"provided",value:"Fictional demo: pitched natural-slate roof."},baseValueId:null});
  return operations;
}

describe.skipIf(!integrationEnabled)("stakeholder staff and customer journey",()=>{
  let database:TestDatabase, context:SurveyContext;
  beforeAll(async()=>{
    database=await createTestDatabase();Object.assign(process.env,{DATABASE_ADMIN_URL:database.adminUrl,DATABASE_APP_URL:database.appUrl});
    const db=database.connect(database.adminUrl);await syncSourceRegistry(db);
    const [owner]=await db.insert(users).values({clerkUserId:"user_journey_owner",email:"owner@example.test"}).returning();
    const [org]=await db.insert(organisations).values({clerkOrganisationId:"org_journey_demo",slug:"journey-demo",name:"Journey demonstration",practiceType:"building_surveying",region:"Bristol",status:"active",isDemo:true,demoGeneration:1}).returning();
    // This test practitioner is explicitly granted both permissions; demo owners
    // created by the application retain false defaults.
    await db.insert(organisationMemberships).values({ organisationId: org.id, userId: owner.id, role: "owner", active: true, canRecordSurvey: true, canApproveReports: true });
    context={organisationId:org.id,internalUserId:owner.id,role:"owner",canRecordSurvey:true,canApproveReports:true};await seedStakeholderDemo(org.id,owner.id,db);
  },120000);
  afterAll(async()=>{vi.unstubAllGlobals();await database?.drop();await stopRelay();});
  it("persists quote, decline, exactly-once deposit, booking, explicit report approval, customer issue and balance",async()=>{
    const noExternal=vi.fn(()=>{throw new Error("Demo called an external service");});vi.stubGlobal("fetch",noExternal);
    const created=await createPublicQuote({organisationId:context.organisationId,actorUserId:context.internalUserId!,requestId:crypto.randomUUID(),firstName:"Featured",lastName:"Customer",email:"featured@example.test",answers:{purpose:"survey-only",propertyAge:"post-1990",propertyType:"house"}});
    const id=created.quote.id as string, route={params:Promise.resolve({id})};
    const request=(path:string,body?:unknown,token=created.token)=>new Request(`http://surveynt.test/api/v1/public/quotes/${id}${path}`,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-quote-token":token},...(body?{body:JSON.stringify(body)}:{})});
    await acceptQuoteAddress(id,created.token,{line1:"1 Fictional Demo Street",city:"Bristol",postcode:"BS1 1AA"});
    expect((await checkout(request("/checkout",{scenario:"failure"}),route)).status).toBe(402);
    const deposits=await Promise.all([checkout(request("/checkout",{purpose:"deposit"}),route),checkout(request("/checkout",{purpose:"deposit"}),route)]);
    expect(deposits.every(response=>response.ok)).toBe(true);
    const found=(await readPublicQuote(id,created.token))!;expect(found.view.depositPaid).toBe(true);const jobId=found.row.jobId!;
    const available=await slots(request("/appointments"),route);const choices=(await available.json()).data;expect(choices.length).toBeGreaterThan(0);
    const first=await book(request("/appointments",{startsAt:choices[0].startsAt}),route),second=await book(request("/appointments",{startsAt:choices[0].startsAt}),route);
    expect((await first.json()).data.id).toBe((await second.json()).data.id);
    const capture=await createSurvey(context,jobId,{serviceLevel:"level_1"});if(capture.kind!=="created")throw new Error(capture.kind);
    expect((await applySyncOperations(context,capture.survey.id,inspectionFixture())).every(result=>result.status==="applied")).toBe(true);
    const draft=await composeSurveyReport(context,capture.survey.id);
    expect((await (await reports(request("/reports"),route)).json()).data).toEqual([]);
    await expect(approveReportVersion(context,capture.survey.id,draft.id,{confirm:false})).rejects.toMatchObject({code:"confirmation_required"});
    await approveReportVersion(context,capture.survey.id,draft.id,{confirm:true,note:"Explicit fictional stakeholder review in isolated test database."});
    await withTenant(createDatabase(),context.organisationId,async tx=>{expect(await enforceStageGate(tx,context,{jobId,targetStage:"issued",overrides:[]})).toMatchObject({kind:"passed"});await tx.update(jobs).set({stage:"issued"}).where(eq(jobs.id,jobId));});
    const issued=(await (await reports(request("/reports"),route)).json()).data;expect(issued).toHaveLength(1);expect(issued[0].content).toBeTruthy();expect(issued[0]).not.toHaveProperty("trace");
    expect((await reports(request("/reports",undefined,"wrong-token"),route)).status).toBe(404);
    expect((await checkout(request("/checkout",{purpose:"balance"}),route)).ok).toBe(true);
    expect((await readPublicQuote(id,created.token))?.view.balanceMinor).toBe(0);
    const db=database.connect(database.adminUrl);const payments=await db.select().from(clientPayments).where(eq(clientPayments.quoteId,id));expect(payments).toHaveLength(2);expect(payments.every(payment=>payment.status==="succeeded")).toBe(true);
    const bills=await db.select().from(invoices).where(eq(invoices.quoteId,id));expect(bills).toHaveLength(2);expect(bills.reduce((sum,bill)=>sum+bill.totalMinor,0)).toBe(found.row.totalMinor);expect(bills.reduce((sum,bill)=>sum+bill.vatMinor,0)).toBe(found.row.vatMinor);
    expect(noExternal).not.toHaveBeenCalled();vi.unstubAllGlobals();
  },120000);
  it("allows only one concurrent customer claim for the same surveyor slot",async()=>{
    const created=await Promise.all(["First","Second"].map(firstName=>createPublicQuote({organisationId:context.organisationId,actorUserId:context.internalUserId!,requestId:crypto.randomUUID(),firstName,email:`${firstName.toLowerCase()}@example.test`,answers:{purpose:"survey-only",propertyAge:"post-1990",propertyType:"house"}})));
    const request=(index:number,path:string,body?:unknown)=>new Request(`http://surveynt.test/api/v1/public/quotes/${created[index].quote.id}${path}`,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-quote-token":created[index].token},...(body?{body:JSON.stringify(body)}:{})});
    const routes=created.map(value=>({params:Promise.resolve({id:value.quote.id as string})}));
    await Promise.all(created.map(value=>acceptQuoteAddress(value.quote.id as string,value.token,{line1:"2 Fictional Demo Street",city:"Bristol",postcode:"BS1 1AA"})));
    await Promise.all(created.map((_,index)=>checkout(request(index,"/checkout",{purpose:"deposit"}),routes[index])));
    const available=(await (await slots(request(0,"/appointments"),routes[0])).json()).data;
    expect(available.length).toBeGreaterThan(0);
    const results=await Promise.all(created.map((_,index)=>book(request(index,"/appointments",{startsAt:available[0].startsAt}),routes[index])));
    expect(results.map(value=>value.status).sort()).toEqual([200,409]);
    const successful=results.find(value=>value.ok)!;
    expect((await successful.json()).data.surveyorId).toBe(context.internalUserId);
  },120000);
});
