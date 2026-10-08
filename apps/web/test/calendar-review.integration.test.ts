import {POST as provisionMissingChannel} from "../src/app/api/platform/calendar-connections/[connectionId]/provision/route";
import {calendarConnectionReviewVersion} from "../src/lib/calendar-missing-channel";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {auditEvents,backgroundJobs,calendarConnections,users,organisations,platformStaff,type Database} from "@surveynt/db";
import {createTestDatabase,integrationEnabled,stopRelay,type TestDatabase} from "@surveynt/db/testing";
const operator=vi.hoisted(()=>({value:{role:"support",platformStaffId:"",demo:false} as {role:string;platformStaffId:string;demo:boolean}|null}));
vi.mock("server-only",()=>({}));vi.mock("../src/lib/access",()=>({platformApiContext:async()=>operator.value}));
import {registerCalendarWebhookAttempt} from "../src/lib/calendar-registration-attempt";
import {POST} from "../src/app/api/platform/background-jobs/[jobId]/calendar-review/route";
import {calendarWebhookToken,decryptCalendarSecret,encryptCalendarSecret} from "../src/lib/calendar-oauth";
import {enqueueGoogleSubscriptionReplacements,processCalendarSubscriptionQueue} from "../src/lib/calendar-subscription-queue";
import {calendarReviewVersion} from "../src/lib/calendar-review-summary";
describe.skipIf(!integrationEnabled)("calendar provider operator reviews",()=>{
 let database:TestDatabase,db:Database,organisationId:string,staffId:string;
 beforeAll(async()=>{
  database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));
  const [org]=await db.insert(organisations).values({clerkOrganisationId:"calendar-review",slug:"calendar-review",name:"Calendar review",practiceType:"building_surveying",region:"Bristol",status:"active"}).returning();organisationId=org.id;
  const [staff]=await db.insert(platformStaff).values({clerkUserId:"calendar-review-staff",role:"support"}).returning();staffId=staff.id;
 },120000);
 beforeEach(()=>{operator.value={role:"support",platformStaffId:staffId,demo:false};});
 afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await database?.drop();await stopRelay();});
 async function fixture(){const connectionId=crypto.randomUUID();return (await db.insert(backgroundJobs).values({organisationId,queue:"calendar_subscription",type:"stop_webhook",status:"failed",attempts:2,payload:{connectionId,encryptedCleanup:encryptCalendarSecret({connectionId,organisationId,userId:crypto.randomUUID(),provider:"google",channelId:"review-channel",resourceId:"resource",tokens:{access_token:"fictional-private-token"}})}}).returning())[0];}
 function input(job:typeof backgroundJobs.$inferSelect){return {reviewVersion:calendarReviewVersion(job),outcome:"removed",verifiedChannelId:"review-channel",evidence:"Provider verified exact channel absence in activity record",confirmed:true};}
 async function submit(job:typeof backgroundJobs.$inferSelect,body:Record<string,unknown>=input(job)){return POST(new Request("https://surveynt.test/api/platform/background-jobs/review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({jobId:job.id})});}
 it("requires authenticated authorised platform staff",async()=>{const job=await fixture();operator.value=null;expect((await submit(job)).status).toBe(401);operator.value={role:"billing",platformStaffId:staffId,demo:false};expect((await submit(job)).status).toBe(403);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0].status).toBe("failed");});
 it("records verified absence and its audit atomically without credential exposure",async()=>{const job=await fixture(),response=await submit(job);expect(response.status).toBe(200);expect(await response.text()).not.toContain("fictional-private-token");const [saved]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id));expect(saved).toMatchObject({status:"completed",payload:{connectionId:job.payload.connectionId}});const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,job.id));expect(audits).toHaveLength(1);expect(audits[0]).toMatchObject({platformStaffId:staffId,action:"calendar.provider_outcome_reviewed"});expect(JSON.stringify(audits)).not.toContain("fictional-private-token");});
 it("allows only one concurrent review of the same snapshot",async()=>{const job=await fixture();const responses=await Promise.all([submit(job),submit(job)]);expect(responses.map(response=>response.status).sort()).toEqual([200,409]);expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,job.id))).toHaveLength(1);});
 it("rejects a changed snapshot without altering the current attempt",async()=>{const job=await fixture();await db.update(backgroundJobs).set({attempts:3}).where(eq(backgroundJobs.id,job.id));expect((await submit(job)).status).toBe(409);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0].attempts).toBe(3);expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,job.id))).toHaveLength(0);});
 it("keeps demo review as an explicit non-persistent preview",async()=>{const job=await fixture();operator.value!.demo=true;const response=await submit(job);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({meta:{persisted:false}});expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0].status).toBe("failed");});
 it("adopts a reviewed lost-response channel without another creation and cleans the old channel",async()=>{
  vi.stubEnv("APP_URL","https://surveynt.test");vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-webhook");
  const [owner]=await db.insert(users).values({clerkUserId:"reviewed-google-owner",email:"review-owner@example.test",firstName:"Review",lastName:"Owner"}).returning();
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider:"google",providerAccountId:"reviewed-google",status:"active",encryptedCredentials:encryptCalendarSecret({access_token:"fictional-token",obtained_at:Date.now(),expires_in:3600}),webhookChannelId:"review-old-channel",webhookResourceId:"review-old-resource",webhookExpiresAt:new Date(Date.now()+3600000)}).returning();
  expect(await enqueueGoogleSubscriptionReplacements()).toBe(1);
  const fetcher=vi.fn().mockRejectedValue(new Error("lost accepted watch response"));vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);
  const [held]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.deduplicationKey,`calendar-renew:${connection.id}:review-old-channel:${connection.webhookExpiresAt!.toISOString()}`));expect(held.status).toBe("failed");
  const snapshot=decryptCalendarSecret<{replacementChannelId:string}>(String(held.payload.encryptedCleanup));
  const expiresAt=new Date(Date.now()+6*86400000).toISOString();
  expect((await submit(held,{...input(held),outcome:"replacement_confirmed",verifiedChannelId:snapshot.replacementChannelId,resourceId:"review-confirmed-resource",expiresAt})).status).toBe(200);
  const [reviewed]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id));
  await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);
  // Simulate a crash after adoption committed but before the attempt settled.
  await db.update(backgroundJobs).set({status:"processing",payload:reviewed.payload,leaseToken:crypto.randomUUID(),lockedUntil:new Date(Date.now()-1000),availableAt:new Date(Date.now()-10000),completedAt:null}).where(eq(backgroundJobs.id,held.id));
  await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id)))[0].status).toBe("completed");
  const [adopted]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id));expect(adopted).toMatchObject({webhookChannelId:snapshot.replacementChannelId,webhookResourceId:"review-confirmed-resource",webhookExpiresAt:new Date(expiresAt)});
  fetcher.mockImplementation(async(_url:string,options:RequestInit)=>{expect(JSON.parse(String(options.body))).toEqual({id:"review-old-channel",resourceId:"review-old-resource"});return new Response(null,{status:204});});
  await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(2);
  const [cleanup]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.deduplicationKey,`calendar-stop:${connection.id}:review-old-channel`));expect(cleanup.status).toBe("completed");
 });

 it("recovers missing Google resource identity through review and exact cleanup",async()=>{
  const [owner]=await db.insert(users).values({clerkUserId:"legacy-google-owner",email:"legacy-owner@example.test",firstName:"Legacy",lastName:"Owner"}).returning();
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider:"google",providerAccountId:"legacy-google",status:"revoked",encryptedCredentials:"",webhookChannelId:"legacy-channel",webhookResourceId:null}).returning();
  const [job]=await db.insert(backgroundJobs).values({organisationId,queue:"calendar_subscription",type:"stop_webhook",status:"failed",payload:{connectionId:connection.id,encryptedCleanup:encryptCalendarSecret({connectionId:connection.id,organisationId,userId:owner.id,provider:"google",channelId:"legacy-channel",resourceId:null,tokens:{access_token:"legacy-token",obtained_at:Date.now(),expires_in:3600}})}}).returning();
  expect((await submit(job,{...input(job),outcome:"cleanup_identity_verified",verifiedChannelId:"legacy-channel",resourceId:"verified-legacy-resource"})).status).toBe(200);
  const fetcher=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>{expect(JSON.parse(String(options.body))).toEqual({id:"legacy-channel",resourceId:"verified-legacy-resource"});return new Response(null,{status:204});});vi.stubGlobal("fetch",fetcher);
  await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0].status).toBe("completed");
 });

 it("reviews a confirmed initial registration for adoption without another provider request",async()=>{
  const [owner]=await db.insert(users).values({clerkUserId:"initial-review-owner",email:"initial-review@example.test",firstName:"Initial",lastName:"Owner"}).returning();
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider:"microsoft",providerAccountId:"initial-reviewed-account",encryptedCredentials:encryptCalendarSecret({access_token:"initial-review-token"})}).returning();
  const expiresAt=new Date(Date.now()+86400000).toISOString();
  const [job]=await db.insert(backgroundJobs).values({organisationId,queue:"calendar_subscription",type:"register_webhook",status:"failed",payload:{connectionId:connection.id,encryptedCleanup:encryptCalendarSecret({connectionId:connection.id,organisationId,userId:owner.id,provider:"microsoft",providerAccountId:connection.providerAccountId,channelId:"confirmed-initial-channel",phase:"confirmed",expectedCredentials:connection.encryptedCredentials,tokens:{access_token:"initial-review-token"},confirmed:{channelId:"confirmed-initial-channel",resourceId:null,expiresAt}})}}).returning();
  expect((await submit(job,{...input(job),outcome:"retry",verifiedChannelId:"confirmed-initial-channel"})).status).toBe(200);
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);expect(fetcher).not.toHaveBeenCalled();
  expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id)))[0]).toMatchObject({webhookChannelId:"confirmed-initial-channel",webhookExpiresAt:new Date(expiresAt)});expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0].status).toBe("completed");
 });

 it("settles a lost initial Google creation response and adopts without another watch",async()=>{
  vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-initial-webhook");
  const [owner]=await db.insert(users).values({clerkUserId:"uncertain-initial-owner",email:"uncertain-initial@example.test",firstName:"Initial",lastName:"Owner"}).returning();
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider:"google",providerAccountId:"uncertain-initial-account",encryptedCredentials:encryptCalendarSecret({access_token:"uncertain-initial-token"})}).returning();
  const fetcher=vi.fn().mockRejectedValue(new Error("lost initial watch response"));vi.stubGlobal("fetch",fetcher);
  await expect(registerCalendarWebhookAttempt(db,connection,{access_token:"uncertain-initial-token"},"https://surveynt.test")).rejects.toThrow("requires provider review");
  const [held]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id);
  const snapshot=decryptCalendarSecret<{channelId:string}>(String(held.payload.encryptedCleanup)),expiresAt=new Date(Date.now()+86400000).toISOString();
  expect((await submit(held,{...input(held),outcome:"registration_confirmed",verifiedChannelId:snapshot.channelId,resourceId:"initial-confirmed-resource",expiresAt})).status).toBe(200);
  await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id)))[0]).toMatchObject({webhookChannelId:snapshot.channelId,webhookResourceId:"initial-confirmed-resource",webhookExpiresAt:new Date(expiresAt)});
 });

 it("verifies an uncertain Microsoft subscription against its exact attempt before adoption",async()=>{
  vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-microsoft-proof");vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_ID","fictional-microsoft-app");
  const [owner]=await db.insert(users).values({clerkUserId:"uncertain-ms-owner",email:"uncertain-ms@example.test",firstName:"Microsoft",lastName:"Owner"}).returning();
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider:"microsoft",providerAccountId:"verified-ms-owner",encryptedCredentials:encryptCalendarSecret({access_token:"ms-token"})}).returning();
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("lost Microsoft creation response")));await expect(registerCalendarWebhookAttempt(db,connection,{access_token:"ms-token",refresh_token:"retained-refresh"},"https://surveynt.test")).rejects.toThrow("requires provider review");
  const [held]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id),snapshot=decryptCalendarSecret<{registrationAttemptId:string;clientState:string}>(String(held.payload.encryptedCleanup));
  const expiresAt=new Date(Date.now()+2*86400000),proposed="verified-ms-subscription",provider={id:proposed,applicationId:"fictional-microsoft-app",resource:"me/events",notificationUrl:"https://surveynt.test/api/webhooks/calendar/microsoft",clientState:snapshot.clientState,changeType:"created,updated,deleted",expirationDateTime:expiresAt.toISOString()};
  const fetcher=vi.fn().mockImplementation(async(url:string)=>new Response(JSON.stringify(url.includes("/me?")?{id:connection.providerAccountId}:{...provider,clientState:"wrong-attempt"})));vi.stubGlobal("fetch",fetcher);
  const review={...input(held),outcome:"registration_confirmed",verifiedChannelId:proposed,verifiedAttemptId:snapshot.registrationAttemptId};
  expect((await submit(held,review)).status).toBe(409);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id)))[0].status).toBe("failed");
  fetcher.mockImplementation(async(url:string)=>new Response(JSON.stringify(url.includes("/me?")?{id:connection.providerAccountId}:provider)));
  expect((await submit(held,review)).status).toBe(200);
  const [queued]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id));expect(decryptCalendarSecret(queued.payload.encryptedCleanup as string)).toMatchObject({tokens:{refresh_token:"retained-refresh"}});
  await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(4);expect(fetcher.mock.calls.every(call=>call[1].method!=="POST")).toBe(true);
  expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id)))[0]).toMatchObject({webhookChannelId:proposed,webhookAttemptId:snapshot.registrationAttemptId,webhookExpiresAt:expiresAt});expect(snapshot.clientState).toBe(calendarWebhookToken(connection.id,snapshot.registrationAttemptId));
 });

 it("commits rotated review credentials before a failed verification and adopts them on retry",async()=>{
  vi.stubEnv("CALENDAR_WEBHOOK_SECRET","refresh-review-proof");vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_ID","refresh-review-app");vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_SECRET","fictional-secret");
  const tokens={access_token:"expired-review-token",refresh_token:"old-review-refresh",obtained_at:Date.now()-7200000,expires_in:3600};
  const [owner]=await db.insert(users).values({clerkUserId:"refresh-review-owner",email:"refresh-review@example.test",firstName:"Review",lastName:"Owner"}).returning();
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider:"microsoft",providerAccountId:"refresh-review-account",encryptedCredentials:encryptCalendarSecret(tokens)}).returning();
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("lost creation response")));
  await expect(registerCalendarWebhookAttempt(db,connection,tokens,"https://surveynt.test")).rejects.toThrow();
  const [held]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id);
  const snapshot=decryptCalendarSecret<{registrationAttemptId:string;clientState:string}>(String(held.payload.encryptedCleanup));
  const proposed="refresh-reviewed-subscription",expiresAt=new Date(Date.now()+2*86400000).toISOString();
  const provider={id:proposed,applicationId:"refresh-review-app",resource:"me/events",notificationUrl:"https://surveynt.test/api/webhooks/calendar/microsoft",clientState:snapshot.clientState,changeType:"created,updated,deleted",expirationDateTime:expiresAt};
  let valid=false;
  const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
   if(url.includes("/oauth2/"))return new Response(JSON.stringify({access_token:"fresh-review-token",refresh_token:"rotated-review-refresh",expires_in:3600}));
   expect(options.headers).toMatchObject({authorization:"Bearer fresh-review-token"});
   return new Response(JSON.stringify(url.includes("/me?")?{id:connection.providerAccountId}:{...provider,clientState:valid?snapshot.clientState:"wrong-proof"}));
  });vi.stubGlobal("fetch",fetcher);
  const review={...input(held),outcome:"registration_confirmed",verifiedChannelId:proposed,verifiedAttemptId:snapshot.registrationAttemptId};
  expect((await submit(held,review)).status).toBe(409);
  const [refreshed]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id));
  expect(refreshed.status).toBe("failed");expect(decryptCalendarSecret(refreshed.payload.encryptedCleanup as string)).toMatchObject({tokens:{access_token:"fresh-review-token",refresh_token:"rotated-review-refresh"}});
  expect((await submit(held,review)).status).toBe(409);
  valid=true;expect((await submit(refreshed,{...review,reviewVersion:calendarReviewVersion(refreshed)})).status).toBe(200);
  await processCalendarSubscriptionQueue(1);
  const [adopted]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id));
  expect(adopted.webhookChannelId).toBe(proposed);expect(decryptCalendarSecret(adopted.encryptedCredentials)).toMatchObject({access_token:"fresh-review-token",refresh_token:"rotated-review-refresh"});
  expect(fetcher.mock.calls.filter(call=>call[1].method==="POST")).toHaveLength(1);
  const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,held.id));expect(audits.map(event=>event.action)).toContain("calendar.review_credentials_refreshed");expect(JSON.stringify(audits)).not.toContain("rotated-review-refresh");
 });

 it("recovers a reviewed pre-dispatch registration for both providers after configuration repair",async()=>{
  for(const provider of ["google","microsoft"]){
   vi.stubEnv("CALENDAR_WEBHOOK_SECRET","");vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_ID","ready-ms-app");
   const [owner]=await db.insert(users).values({clerkUserId:`ready-${provider}`,email:`ready-${provider}@example.test`,firstName:"Ready",lastName:"Owner"}).returning();
   const tokens={access_token:"ready-token",obtained_at:Date.now(),expires_in:3600};
   const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider,providerAccountId:`ready-${provider}`,encryptedCredentials:encryptCalendarSecret(tokens)}).returning();
   const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await expect(registerCalendarWebhookAttempt(db,connection,tokens,"https://surveynt.test")).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
   const [held]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id);
   const snapshot=decryptCalendarSecret<{phase:string;channelId:string|null;registrationAttemptId:string}>(String(held.payload.encryptedCleanup));expect(snapshot.phase).toBe("ready");
   expect((await submit(held,{...input(held),outcome:"retry",verifiedChannelId:snapshot.channelId??snapshot.registrationAttemptId,verifiedAttemptId:snapshot.registrationAttemptId})).status).toBe(200);
   vi.stubEnv("CALENDAR_WEBHOOK_SECRET","ready-repaired-proof");
   fetcher.mockImplementation(async(_url:string,options:RequestInit)=>{
    const [sending]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id));expect(decryptCalendarSecret(sending.payload.encryptedCleanup as string)).toMatchObject({phase:"dispatched",registrationAttemptId:snapshot.registrationAttemptId});
    const body=JSON.parse(String(options.body));return new Response(JSON.stringify(provider==="google"?{id:body.id,resourceId:"ready-resource",expiration:String(Date.now()+86400000)}:{id:"ready-ms-channel",expirationDateTime:new Date(Date.now()+86400000).toISOString()}));
   });await processCalendarSubscriptionQueue(1);
   const [saved]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id));expect(saved.status).toBe("completed");expect(fetcher).toHaveBeenCalledTimes(1);
   const [adopted]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id));expect(adopted.webhookChannelId).toBe(provider==="google"?snapshot.channelId:"ready-ms-channel");if(provider==="microsoft")expect(adopted.webhookAttemptId).toBe(snapshot.registrationAttemptId);
  }
 });

 it("holds repaired registration after a lost creation response without repeating dispatch",async()=>{
  for(const provider of ["google","microsoft"]){
   vi.stubEnv("CALENDAR_WEBHOOK_SECRET","");vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_ID","lost-ready-app");
   const [owner]=await db.insert(users).values({clerkUserId:`lost-ready-${provider}`,email:`lost-ready-${provider}@example.test`,firstName:"Lost",lastName:"Owner"}).returning();
   const tokens={access_token:"ready-lost-token",obtained_at:Date.now(),expires_in:3600};const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider,providerAccountId:`lost-ready-${provider}`,encryptedCredentials:encryptCalendarSecret(tokens)}).returning();
   const fetcher=vi.fn().mockRejectedValue(new Error("lost response"));vi.stubGlobal("fetch",fetcher);await expect(registerCalendarWebhookAttempt(db,connection,tokens,"https://surveynt.test")).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
   const [held]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id),snapshot=decryptCalendarSecret<{channelId:string|null;registrationAttemptId:string}>(String(held.payload.encryptedCleanup));
   const body={...input(held),outcome:"retry",verifiedChannelId:snapshot.channelId??snapshot.registrationAttemptId,verifiedAttemptId:snapshot.registrationAttemptId};expect((await submit(held,body)).status).toBe(200);
   vi.stubEnv("CALENDAR_WEBHOOK_SECRET","lost-ready-proof");await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);
   const [uncertain]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id));expect(uncertain.status).toBe("failed");expect(decryptCalendarSecret(uncertain.payload.encryptedCleanup as string)).toMatchObject({phase:"dispatched",registrationAttemptId:snapshot.registrationAttemptId});
   expect((await submit(uncertain,{...body,reviewVersion:calendarReviewVersion(uncertain)})).status).toBe(409);
   await db.update(backgroundJobs).set({status:"queued",availableAt:new Date(Date.now()-1000)}).where(eq(backgroundJobs.id,held.id));await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id)))[0].status).toBe("failed");
  }
 });

 it("requires authorised current provider absence review and queues one missing-channel registration",async()=>{
  vi.stubEnv("APP_URL","https://surveynt.test");vi.stubEnv("CALENDAR_WEBHOOK_SECRET","missing-channel-proof");
  for(const provider of ["google","microsoft"]){
   const [owner]=await db.insert(users).values({clerkUserId:`missing-${provider}`,email:`missing-${provider}@example.test`,firstName:"Missing",lastName:"Owner"}).returning();
   const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider,providerAccountId:`missing-${provider}`,encryptedCredentials:encryptCalendarSecret({access_token:"missing-token",obtained_at:Date.now(),expires_in:3600})}).returning();
   const body={reviewVersion:calendarConnectionReviewVersion(connection),verifiedAccountId:connection.providerAccountId,evidence:"Provider activity reviewed; this exact account has no active Surveynt subscription",confirmed:true};
   const send=(value=body)=>provisionMissingChannel(new Request("https://surveynt.test/review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)}),{params:Promise.resolve({connectionId:connection.id})});
   operator.value=null;expect((await send()).status).toBe(401);operator.value={role:"billing",platformStaffId:staffId,demo:false};expect((await send()).status).toBe(403);operator.value={role:"support",platformStaffId:staffId,demo:false};
   expect((await send({...body,verifiedAccountId:"wrong-account"})).status).toBe(409);
   operator.value!.demo=true;expect((await send()).status).toBe(200);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id)).toHaveLength(0);operator.value!.demo=false;
   const responses=await Promise.all([send(),send()]);expect(responses.map(row=>row.status).sort()).toEqual([200,409]);
   const [queued]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id);expect(queued.status).toBe("queued");expect(decryptCalendarSecret(queued.payload.encryptedCleanup as string)).toMatchObject({phase:"ready"});
   const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,connection.id));expect(audits).toHaveLength(1);expect(JSON.stringify(audits)).not.toContain("missing-token");
   const fetcher=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>{const body=JSON.parse(String(options.body));return new Response(JSON.stringify(provider==="google"?{id:body.id,resourceId:"missing-resource",expiration:String(Date.now()+86400000)}:{id:"missing-ms-channel",expirationDateTime:new Date(Date.now()+86400000).toISOString()}));});vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id)))[0].webhookChannelId).toBeTruthy();
   expect((await send()).status).toBe(409);
  }
 });

 it("settles reviewed initial non-creation for both providers without dispatching again",async()=>{
  vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-noncreation-proof");
  for(const provider of ["google","microsoft"]){
   const [owner]=await db.insert(users).values({clerkUserId:`noncreation-${provider}-owner`,email:`noncreation-${provider}@example.test`,firstName:"Review",lastName:"Owner"}).returning();
   const [connection]=await db.insert(calendarConnections).values({organisationId,userId:owner.id,provider,providerAccountId:`noncreation-${provider}`,encryptedCredentials:encryptCalendarSecret({access_token:"noncreation-token"})}).returning();
   const fetcher=vi.fn().mockRejectedValue(new Error("lost response requiring provider review"));vi.stubGlobal("fetch",fetcher);await expect(registerCalendarWebhookAttempt(db,connection,{access_token:"noncreation-token"},"https://surveynt.test")).rejects.toThrow("provider review");
   const [held]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===connection.id),snapshot=decryptCalendarSecret<{registrationAttemptId:string;channelId:string|null}>(String(held.payload.encryptedCleanup));
   expect((await submit(held,{...input(held),outcome:"registration_not_created",verifiedAttemptId:snapshot.registrationAttemptId,verifiedChannelId:snapshot.channelId??snapshot.registrationAttemptId})).status).toBe(200);
   expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id)))[0]).toMatchObject({status:"cancelled",payload:{connectionId:connection.id}});await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);
   const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,held.id));expect(audits.some(audit=>audit.action==="calendar.provider_outcome_reviewed"&&audit.metadata.outcome==="registration_not_created")).toBe(true);
  }
 });

});
