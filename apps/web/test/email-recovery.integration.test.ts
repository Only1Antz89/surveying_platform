import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents,backgroundJobs,communicationDeliveries,organisationOperationalSettings,organisations,platformStaff,type Database } from "@surveynt/db";
import { createTestDatabase,integrationEnabled,stopRelay,type TestDatabase } from "@surveynt/db/testing";
const state=vi.hoisted(()=>({send:vi.fn(),operator:{role:"super_admin",demo:false,platformStaffId:""}}));
vi.mock("server-only",()=>({}));
vi.mock("../src/lib/access",()=>({platformApiContext:async()=>state.operator}));
vi.mock("../src/lib/email",async original=>({...await original<typeof import("../src/lib/email")>(),sendEmail:state.send}));
import { EmailDeliveryError } from "../src/lib/email";
import { completeEmailDelivery,processEmailQueue,recoverEmailLeases } from "../src/lib/email-queue";
import { POST as review } from "../src/app/api/platform/background-jobs/[jobId]/review/route";
import { POST as retry } from "../src/app/api/platform/background-jobs/[jobId]/retry/route";
describe.skipIf(!integrationEnabled)("durable email dispatch recovery",()=>{
  let database:TestDatabase,db:Database,orgId:string;
  const payload={recipients:["fictional@example.test"],organisationName:"Fictional practice",daysRemaining:3,trialEndsAt:"2026-10-08T00:00:00Z",billingUrl:"https://surveynt.test/billing"};
  const route=(id:string)=>({params:Promise.resolve({jobId:id})});
  const request=(body?:unknown)=>new Request("http://surveynt.test/review",{method:"POST",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined});
  async function job(values:Partial<typeof backgroundJobs.$inferInsert>={}){
    const [delivery]=await db.insert(communicationDeliveries).values({organisationId:orgId,recipient:"fictional@example.test"}).returning();
    const [record]=await db.insert(backgroundJobs).values({organisationId:orgId,queue:"email",type:"trial_ending_notice",payload:{...payload,deliveryId:delivery.id},...values}).returning();return{record,delivery};
  }
  async function stored(id:string){return(await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,id)))[0];}
  beforeAll(async()=>{
    database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("SMTP2GO_API_KEY","local-test");vi.stubEnv("SMTP2GO_SENDER","notifications@example.test");
    const [org]=await db.insert(organisations).values({clerkOrganisationId:"email-recovery",slug:"email-recovery",name:"Email recovery",practiceType:"building_surveying",region:"Bristol",status:"active"}).returning();orgId=org.id;
    const [operator]=await db.insert(platformStaff).values({clerkUserId:"email-operator",role:"super_admin"}).returning();state.operator.platformStaffId=operator.id;
  },120000);
  afterAll(async()=>{vi.unstubAllEnvs();await database?.drop();await stopRelay();});
  it("claims a concurrent job once and commits provider acceptance with delivery and audit",async()=>{
    const {record,delivery}=await job();state.send.mockReset().mockResolvedValue({providerMessageId:"mail-concurrent"});
    await Promise.all([processEmailQueue(),processEmailQueue()]);expect(state.send).toHaveBeenCalledTimes(1);expect(await stored(record.id)).toMatchObject({status:"completed",providerMessageId:"mail-concurrent",lockedUntil:null});
    const [sent]=await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.id,delivery.id));expect(sent.status).toBe("sent");expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,record.id))).toHaveLength(1);
  });
  it("reclaims pre-dispatch claims but quarantines sending and legacy claims",async()=>{
    const past=new Date(Date.now()-600000);
    const safe=await job({status:"processing",attempts:1,leaseToken:crypto.randomUUID(),lockedUntil:past});
    const sending=await job({status:"sending",attempts:1,leaseToken:crypto.randomUUID(),lockedUntil:past});
    const legacy=await job({status:"processing",attempts:1,updatedAt:past});
    expect(await recoverEmailLeases(db)).toBe(3);expect((await stored(safe.record.id)).status).toBe("queued");expect((await stored(sending.record.id)).status).toBe("delivery_unknown");expect((await stored(legacy.record.id)).status).toBe("delivery_unknown");
    state.send.mockReset().mockResolvedValue({providerMessageId:"mail-recovered"});await processEmailQueue();expect(state.send).toHaveBeenCalledTimes(1);
    expect((await retry(request(),route(sending.record.id))).status).toBe(409);
  });
  it("retries only verified rejection and holds ambiguous acceptance for review",async()=>{
    const rejected=await job();state.send.mockReset().mockRejectedValue(new EmailDeliveryError("Verified provider rejection",true));await processEmailQueue();expect(await stored(rejected.record.id)).toMatchObject({status:"queued",attempts:1});
    const uncertain=await job();state.send.mockRejectedValue(new EmailDeliveryError("Connection lost",false));await processEmailQueue();expect((await stored(uncertain.record.id)).status).toBe("delivery_unknown");
    state.send.mockClear();await processEmailQueue();expect(state.send).not.toHaveBeenCalled();
  });
  it("records reviewed acceptance without resending and rejects stale or restricted reviews",async()=>{
    const {record}=await job({status:"delivery_unknown",attempts:2,leaseToken:crypto.randomUUID()});
    const body={expectedAttempts:2,expectedLeaseToken:record.leaseToken,outcome:"accepted",providerMessageId:"mail-reviewed",evidence:"Checked fictional provider activity acceptance",confirmed:true};
    state.operator.role="finance";expect((await review(request(body),route(record.id))).status).toBe(403);state.operator.role="super_admin";
    expect((await review(request({...body,expectedAttempts:1}),route(record.id))).status).toBe(409);expect((await review(request(body),route(record.id))).ok).toBe(true);expect((await stored(record.id)).status).toBe("completed");expect((await review(request(body),route(record.id))).status).toBe(409);
  });
  it("uses a fresh attempt after reviewed rejection and fences a late worker",async()=>{
    const {record}=await job({status:"delivery_unknown",attempts:2,leaseToken:crypto.randomUUID()});
    const body={expectedAttempts:2,expectedLeaseToken:record.leaseToken,outcome:"not_accepted",evidence:"Provider investigation confirms no acceptance",confirmed:true};
    expect((await review(request(body),route(record.id))).ok).toBe(true);expect(await completeEmailDelivery(db,record.id,record.leaseToken!,"mail-late")).toBe(false);
    state.send.mockReset().mockResolvedValue({providerMessageId:"mail-after-review"});await processEmailQueue();const current=await stored(record.id);expect(current.status).toBe("completed");expect(current.leaseToken).not.toBe(record.leaseToken);
  });
  it("routes legacy failures to provider review instead of blind retries",async()=>{
    const {record}=await job({status:"failed",attempts:5});
    const response=await retry(request(),route(record.id));expect(response.ok).toBe(true);expect((await response.json()).meta.verificationRequired).toBe(true);expect((await stored(record.id)).status).toBe("delivery_unknown");
  });
  it("does not let a malformed historical delivery link strand recovery",async()=>{
    const {record}=await job({status:"processing",attempts:1,updatedAt:new Date(Date.now()-600000),payload:{...payload,deliveryId:"invalid-legacy-reference"}});
    await recoverEmailLeases(db);expect((await stored(record.id)).status).toBe("delivery_unknown");
  });
  it("allows a late confirmed response for the quarantined original attempt",async()=>{
    const {record}=await job({status:"sending",attempts:1,leaseToken:crypto.randomUUID(),lockedUntil:new Date(Date.now()-600000)});await recoverEmailLeases(db);
    expect(await completeEmailDelivery(db,record.id,record.leaseToken!,"mail-late-confirmed")).toBe(true);expect(await completeEmailDelivery(db,record.id,record.leaseToken!,"mail-late-confirmed")).toBe(false);
  });
  it("suppresses opted-out customer quote emails with durable evidence while preserving billing notices",async()=>{
    await db.insert(organisationOperationalSettings).values({organisationId:orgId,notificationPreferences:{customer_quote_issued:false,trial_ending_notice:false}});
    const quote=await job({type:"customer_quote_issued",payload:{recipients:["fictional@example.test"],organisationName:"Fictional practice",customerName:"Fictional customer",quoteReference:"QUO-123",total:"£200",expiresAt:"2026-10-08T00:00:00Z",quoteUrl:"https://surveynt.test/quote"}});
    // Include the real delivery link to prove its status changes with the job.
    await db.update(backgroundJobs).set({payload:{...quote.record.payload,deliveryId:quote.delivery.id}}).where(eq(backgroundJobs.id,quote.record.id));
    const billing=await job();
    state.send.mockReset().mockResolvedValue({providerMessageId:"required-billing"});
    const result=await processEmailQueue();expect(result.suppressed).toBe(1);expect(state.send).toHaveBeenCalledTimes(1);
    expect(await stored(quote.record.id)).toMatchObject({status:"completed",providerMessageId:null,lockedUntil:null});
    expect((await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.id,quote.delivery.id)))[0].status).toBe("suppressed");
    expect((await db.select().from(auditEvents).where(eq(auditEvents.resourceId,quote.record.id)))[0].action).toBe("notification.email_suppressed");
    expect((await stored(billing.record.id)).status).toBe("completed");
    await db.update(organisationOperationalSettings).set({notificationPreferences:{customer_quote_issued:true}}).where(eq(organisationOperationalSettings.organisationId,orgId));
    state.send.mockClear();await processEmailQueue();expect(state.send).not.toHaveBeenCalled();
    await db.update(organisationOperationalSettings).set({emailTemplates:{customer_quote_issued:{subject:"Practice quote {{quoteReference}}",introduction:"Hello {{customerName}}"}}}).where(eq(organisationOperationalSettings.organisationId,orgId));
    await job({type:"customer_quote_issued",payload:quote.record.payload});
    await processEmailQueue();expect(state.send).toHaveBeenCalledTimes(1);expect(state.send.mock.calls[0][0].subject).toBe("Practice quote QUO-123");
  });

});
