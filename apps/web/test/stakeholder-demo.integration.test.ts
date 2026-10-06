import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { and,count,eq,sql } from "drizzle-orm";
import { appointments,backgroundJobs,clients,clientPayments,createDatabase,customerQuotes,invoices,jobs,memberWorkProfiles,organisationDocuments,organisations,properties,userProfiles,users,withTenant } from "@surveynt/db";
import { createTestDatabase,integrationEnabled,stopRelay,type TestDatabase } from "@surveynt/db/testing";
import { issueDemoCustomerLink,seedStakeholderDemo } from "../src/lib/stakeholder-demo";
import { convertPaidQuote,createPendingDeposit,listFirmOperations,readPublicQuote } from "../src/lib/firm-operations";
import { processIntelligenceRun,requestIntelligenceRefresh } from "../src/lib/intelligence";
import { syncSourceRegistry } from "@surveynt/property-data/importers";
import { practiceInsights } from "../src/lib/insights";
import { documentAccess } from "../src/lib/document-access";
describe.skipIf(!integrationEnabled)("persistent stakeholder demo",()=>{
  let database:TestDatabase,orgId:string,ownerId:string,otherId:string;
  beforeAll(async()=>{database=await createTestDatabase();Object.assign(process.env,{DATABASE_ADMIN_URL:database.adminUrl,DATABASE_APP_URL:database.appUrl,PROPERTY_INTELLIGENCE_ENABLED:"false"});const admin=database.connect(database.adminUrl);await syncSourceRegistry(admin);const [owner,other]=await admin.insert(users).values([{clerkUserId:"user_demo_owner",email:"owner@example.test"},{clerkUserId:"user_demo_other",email:"other@example.test"}]).returning();ownerId=owner.id;otherId=other.id;const [org]=await admin.insert(organisations).values({clerkOrganisationId:"org_persistent_demo",slug:"persistent-demo",name:"Test demo",practiceType:"building_surveying",region:"Bristol",status:"active",isDemo:true,demoGeneration:1}).returning();orgId=org.id;await seedStakeholderDemo(orgId,ownerId,admin);},120000);
  afterAll(async()=>{vi.unstubAllGlobals();await database?.drop();await stopRelay();});
  it("seeds six customers, eight linked properties and twelve jobs exactly once",async()=>{const db=database.connect(database.adminUrl);expect(await seedStakeholderDemo(orgId,ownerId,db)).toEqual({seeded:false});for(const [table,total] of [[clients,6],[properties,8],[jobs,12]] as const){const [r]=await db.select({n:count()}).from(table).where(eq(table.organisationId,orgId));expect(r.n).toBe(total);}const mismatched=await db.execute(sql`select count(*)::int n from jobs j join properties p on p.id=j.property_id where j.organisation_id=${orgId} and j.client_id<>p.client_id`);expect(mismatched.rows[0].n).toBe(0);});
  it("rotates scoped customer links and revokes the previous token",async()=>{const db=database.connect(database.adminUrl);const [quote]=await db.select().from(customerQuotes).where(eq(customerQuotes.organisationId,orgId)).limit(1);const first=await issueDemoCustomerLink(orgId,quote.id,ownerId),second=await issueDemoCustomerLink(orgId,quote.id,ownerId);expect(await readPublicQuote(quote.id,first.url.split("#")[1])).toBeNull();expect((await readPublicQuote(quote.id,second.url.split("#")[1]))?.view.demo).toBe(true);});
  it("persists canonical intelligence without calling any live provider",async()=>{const fetchMock=vi.fn(()=>{throw new Error("Demo contacted a live provider");});vi.stubGlobal("fetch",fetchMock);const db=database.connect(database.adminUrl);const [property]=await db.select().from(properties).where(eq(properties.organisationId,orgId)).limit(1);const queued=await requestIntelligenceRefresh({organisationId:orgId,internalUserId:ownerId},property.id);expect(queued.kind).toBe("queued");if(queued.kind==="queued"){const result=await processIntelligenceRun(orgId,queued.run.id);const [job]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.deduplicationKey,`intelligence:${queued.run.id}`));expect(job.error).toBeNull();expect(result).toMatchObject({processed:true,status:"partial"});};expect(fetchMock).not.toHaveBeenCalled();vi.unstubAllGlobals();});
  it("isolates personal profiles by authenticated user context",async()=>{const db=database.connect(database.appUrl);await db.transaction(async tx=>{await tx.execute(sql`select set_config('app.current_user_id',${ownerId},true)`);await tx.insert(userProfiles).values({userId:ownerId,ricsNumber:"SELF-DECLARED-DEMO"});expect(await tx.select().from(userProfiles)).toHaveLength(1);});await db.transaction(async tx=>{await tx.execute(sql`select set_config('app.current_user_id',${otherId},true)`);expect(await tx.select().from(userProfiles)).toHaveLength(0);});});
  it("allows scheduling reads but restricts personal work-profile mutations to their owner",async()=>{
    const admin=database.connect(database.adminUrl),app=database.connect(database.appUrl);
    await admin.insert(memberWorkProfiles).values({organisationId:orgId,userId:otherId,timezone:"Europe/London"});
    await withTenant(app,orgId,async tx=>{
      await tx.execute(sql`select set_config('app.current_user_id',${ownerId},true)`);
      await tx.insert(memberWorkProfiles).values({organisationId:orgId,userId:ownerId,timezone:"Europe/London"});
      expect(await tx.select().from(memberWorkProfiles)).toHaveLength(2);
      expect(await tx.update(memberWorkProfiles).set({routeOrigin:"Not permitted"}).where(eq(memberWorkProfiles.userId,otherId)).returning()).toHaveLength(0);
    });
    await expect(withTenant(app,orgId,async tx=>{await tx.execute(sql`select set_config('app.current_user_id',${ownerId},true)`);await tx.insert(memberWorkProfiles).values({organisationId:orgId,userId:otherId,timezone:"Europe/London"});})).rejects.toThrow();
    expect(await withTenant(app,otherId,tx=>tx.select().from(memberWorkProfiles))).toHaveLength(0);
  });
  it("hides restricted and other surveyors’ job documents",async()=>{
    const admin=database.connect(database.adminUrl),app=database.connect(database.appUrl);
    const [job]=await admin.select().from(jobs).where(eq(jobs.organisationId,orgId)).limit(1);
    await admin.update(jobs).set({assignedSurveyorId:ownerId}).where(eq(jobs.id,job.id));
    const base={organisationId:orgId,name:"Fictional permission fixture",category:"test",blobUrl:"private://test",blobPathname:"test",checksum:"test",contentType:"text/plain",sizeBytes:1};
    const [restricted,assigned]=await admin.insert(organisationDocuments).values([{...base,accessClass:"restricted"},{...base,accessClass:"job",jobId:job.id}]).returning();
    const own=await withTenant(app,orgId,tx=>tx.select({id:organisationDocuments.id}).from(organisationDocuments).where(and(eq(organisationDocuments.organisationId,orgId),documentAccess("surveyor",ownerId))));
    expect(own.some(row=>row.id===restricted.id)).toBe(false);expect(own.some(row=>row.id===assigned.id)).toBe(true);
    const other=await withTenant(app,orgId,tx=>tx.select({id:organisationDocuments.id}).from(organisationDocuments).where(and(eq(organisationDocuments.organisationId,orgId),documentAccess("surveyor",otherId))));
    expect(other.some(row=>row.id===assigned.id)).toBe(false);
  });
  it("aggregates multiple payments and refunds into one invoice row",async()=>{const db=database.connect(database.adminUrl);const [invoice]=await db.insert(invoices).values({organisationId:orgId,number:"MULTI-PAYMENT-TEST",status:"part_paid",subtotalMinor:10000,totalMinor:10000,vatMinor:0}).returning();await db.insert(clientPayments).values([{organisationId:orgId,invoiceId:invoice.id,purpose:"balance",status:"succeeded",amountMinor:4000},{organisationId:orgId,invoiceId:invoice.id,purpose:"balance",status:"partially_refunded",amountMinor:3000,refundedMinor:1000}]);const data=await listFirmOperations(orgId),rows=data.finance.filter(r=>r.invoice.id===invoice.id);expect(rows).toHaveLength(1);expect(rows[0].paidMinor).toBe(6000);expect(rows[0].outstandingMinor).toBe(4000);});
  it("derives period insights from complete records and never combines currencies",async()=>{
    const db=database.connect(database.adminUrl);
    await db.insert(invoices).values({organisationId:orgId,number:"EURO-INSIGHTS-TEST",currency:"EUR",status:"open",subtotalMinor:1000,totalMinor:1000,vatMinor:0,issuedAt:new Date()});
    const insights=await practiceInsights(orgId,new Date(Date.now()-86400000),new Date(Date.now()+86400000));
    expect(insights.quotes).toBe(12);expect(insights.pipeline.reduce((sum,row)=>sum+row.count,0)).toBe(12);
    expect(insights.money.find(row=>row.currency==="EUR")?.outstandingMinor).toBe(1000);
    expect(insights.money.find(row=>row.currency==="GBP")?.refundedMinor).toBe(1000);
    const operations=await listFirmOperations(orgId);
    expect(insights.money.reduce((sum,row)=>sum+row.outstandingMinor,0)).toBe(operations.totals.outstanding);
    expect(operations.quotes.every(quote=>!("accessTokenHash" in quote))).toBe(true);
  });
  it("converts a deposit exactly once and refuses guessed tenant IDs",async()=>{const db=database.connect(database.adminUrl);const [quote]=await db.select().from(customerQuotes).where(and(eq(customerQuotes.organisationId,orgId),eq(customerQuotes.status,"issued"))).limit(1);await db.update(customerQuotes).set({status:"accepted",propertyAddress:"1 Demo Street, Bristol, BS1 1AA",city:"Bristol",postcode:"BS1 1AA"}).where(eq(customerQuotes.id,quote.id));const [accepted]=await db.select().from(customerQuotes).where(eq(customerQuotes.id,quote.id));const {payment}=await createPendingDeposit(accepted);const input={paymentId:payment.id,checkoutSessionId:`demo_test_${payment.id}`,paymentIntentId:null};const first=await convertPaidQuote(input),second=await convertPaidQuote(input);expect(second).toBe(first);expect(await withTenant(createDatabase(database.appUrl),otherId,tx=>tx.select().from(appointments).where(eq(appointments.organisationId,orgId)))).toHaveLength(0);});
});
