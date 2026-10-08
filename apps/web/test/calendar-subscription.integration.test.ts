import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {auditEvents,backgroundJobs,calendarConnections,organisations,users,type Database} from "@surveynt/db";
import {createTestDatabase,integrationEnabled,stopRelay,type TestDatabase} from "@surveynt/db/testing";
import {decryptCalendarSecret,encryptCalendarSecret} from "../src/lib/calendar-oauth";
import {enqueueGoogleSubscriptionReplacements,enqueueMicrosoftSubscriptionRenewals,processCalendarSubscriptionQueue} from "../src/lib/calendar-subscription-queue";
describe.skipIf(!integrationEnabled)("durable calendar subscription cleanup",()=>{
 let database:TestDatabase,db:Database,organisationId:string,userId:string;
 beforeAll(async()=>{
  database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));
  const [org]=await db.insert(organisations).values({clerkOrganisationId:"cleanup",slug:"cleanup",name:"Cleanup",practiceType:"building_surveying",region:"Bristol",status:"active"}).returning();organisationId=org.id;
  const [user]=await db.insert(users).values({clerkUserId:"cleanup-user",email:"cleanup@example.test",firstName:"Cleanup",lastName:"Reviewer"}).returning();userId=user.id;
 },120000);
 afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await database?.drop();await stopRelay();});
 async function fixture(options:{active?:boolean;expired?:boolean;resourceId?:string|null;unknownLifetime?:boolean}={}){
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId,provider:"google",providerAccountId:crypto.randomUUID(),status:options.active?"active":"revoked",encryptedCredentials:"",webhookChannelId:crypto.randomUUID(),webhookResourceId:options.resourceId===undefined?"resource":options.resourceId}).returning();
  const encryptedCleanup=encryptCalendarSecret({connectionId:connection.id,organisationId,userId,provider:"google",channelId:connection.webhookChannelId,resourceId:connection.webhookResourceId,tokens:{access_token:"fictional-secret-token",...(options.unknownLifetime?{}:{refresh_token:"fictional-refresh-token"}),...(options.unknownLifetime?{}:{obtained_at:Date.now()-(options.expired?7200000:0),expires_in:3600})}});
  const [job]=await db.insert(backgroundJobs).values({organisationId,queue:"calendar_subscription",type:"stop_webhook",availableAt:new Date(Date.now()-1000),payload:{connectionId:connection.id,encryptedCleanup}}).returning();return {connection,job};
 }
 async function read(id:string){return (await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,id)))[0];}
 it("removes the exact recorded channel and clears credentials only after success",async()=>{
  const {connection,job}=await fixture();const fetcher=vi.fn().mockImplementation(async()=>new Response(null,{status:204}));vi.stubGlobal("fetch",fetcher);
  await processCalendarSubscriptionQueue(1);expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({id:connection.webhookChannelId,resourceId:"resource"});
  expect(await read(job.id)).toMatchObject({status:"completed",attempts:1,payload:{connectionId:connection.id},leaseToken:null});
  expect(JSON.stringify((await read(job.id)).payload)).not.toContain("fictional-secret-token");
  const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,job.id));expect(audits).toHaveLength(1);expect(audits[0]).toMatchObject({action:"calendar.subscription_cleanup_completed",metadata:{attempt:1}});
 });
 it("cancels cleanup when an active connection still uses that channel",async()=>{
  const {job,connection}=await fixture({active:true});const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);
  expect((await read(job.id)).status).toBe("cancelled");expect(fetcher).not.toHaveBeenCalled();
  await db.update(calendarConnections).set({status:"revoked"}).where(eq(calendarConnections.id,connection.id));
 });
 it("retains encrypted recovery evidence for missing resource and expired credentials",async()=>{
  for(const options of [{resourceId:null},{expired:true}]){
   const {job}=await fixture(options);const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);
   expect(await read(job.id)).toMatchObject({status:"failed",payload:job.payload});expect(fetcher).not.toHaveBeenCalled();
  }
 });
 it("uses provider authentication for historical unknown token lifetimes",async()=>{
  for(const status of [204,401]){
   const {job}=await fixture({unknownLifetime:true});const fetcher=vi.fn().mockImplementation(async()=>new Response(null,{status}));vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);
   expect(fetcher).toHaveBeenCalledTimes(1);expect((await read(job.id)).status).toBe(status===204?"completed":"failed");
   if(status===401)expect((await read(job.id)).payload).toEqual(job.payload);
  }
 });
 it("retries an uncertain provider response and converges on absence",async()=>{
  const {job}=await fixture();vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("lost provider response")));await processCalendarSubscriptionQueue(1);
  expect(await read(job.id)).toMatchObject({status:"queued",payload:job.payload,attempts:1});
  await db.update(backgroundJobs).set({availableAt:new Date(Date.now()-1000)}).where(eq(backgroundJobs.id,job.id));
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(null,{status:404})));await processCalendarSubscriptionQueue(1);
  expect(await read(job.id)).toMatchObject({status:"completed",attempts:2});
 });
 it("durably saves rotated refresh credentials before retrying cleanup",async()=>{
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","fictional-client");vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET","fictional-secret");
  const {job}=await fixture({expired:true});
  const fetcher=vi.fn().mockImplementation(async(url:string)=>{
   if(url.includes("oauth2.googleapis.com"))return new Response(JSON.stringify({access_token:"renewed-token",refresh_token:"rotated-refresh",expires_in:3600}));
   const saved=await read(job.id);expect(decryptCalendarSecret<{tokens:{refresh_token:string}}>(String(saved.payload.encryptedCleanup)).tokens.refresh_token).toBe("rotated-refresh");
   throw new Error("lost stop response");
  });vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);
  expect((await read(job.id)).status).toBe("queued");
  await db.update(backgroundJobs).set({availableAt:new Date(Date.now()-1000)}).where(eq(backgroundJobs.id,job.id));
  fetcher.mockImplementation(async()=>new Response(null,{status:204}));await processCalendarSubscriptionQueue(1);
  expect((await read(job.id)).status).toBe("completed");expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it("drains fast cleanup jobs in a bounded batch and reserves time for the next provider call",async()=>{
  const jobs=await Promise.all([fixture(),fixture(),fixture()]);
  const fetcher=vi.fn().mockImplementation(async()=>new Response(null,{status:204}));vi.stubGlobal("fetch",fetcher);
  expect(await processCalendarSubscriptionQueue(10)).toMatchObject({processed:3});expect(fetcher).toHaveBeenCalledTimes(3);
  for(const {job} of jobs)expect((await read(job.id)).status).toBe("completed");
  const waiting=await fixture();expect(await processCalendarSubscriptionQueue(10,Date.now()+34000)).toMatchObject({processed:0});expect((await read(waiting.job.id)).status).toBe("queued");
  await processCalendarSubscriptionQueue(1);expect((await read(waiting.job.id)).status).toBe("completed");
 });
 it("allows only one concurrent provider attempt for one job",async()=>{
  const {job}=await fixture();const fetcher=vi.fn().mockImplementation(async()=>new Response(null,{status:204}));vi.stubGlobal("fetch",fetcher);
  await Promise.all([processCalendarSubscriptionQueue(1),processCalendarSubscriptionQueue(1)]);
  expect(fetcher).toHaveBeenCalledTimes(1);expect((await read(job.id)).attempts).toBe(1);
 });
 it("fences a late completion after its claim has changed",async()=>{
  const {job}=await fixture();const replacement=crypto.randomUUID();
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>{
   await db.update(backgroundJobs).set({leaseToken:replacement}).where(eq(backgroundJobs.id,job.id));return new Response(null,{status:204});
  }));await processCalendarSubscriptionQueue(1);
  expect(await read(job.id)).toMatchObject({status:"processing",leaseToken:replacement,payload:job.payload});
  expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,job.id))).toHaveLength(0);
  await db.update(backgroundJobs).set({status:"failed"}).where(eq(backgroundJobs.id,job.id));
 });
 it("deduplicates due renewals and stores only the provider-confirmed expiry",async()=>{
  const expiresAt=new Date(Date.now()+2*86400000);
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId,provider:"microsoft",providerAccountId:crypto.randomUUID(),status:"active",encryptedCredentials:encryptCalendarSecret({access_token:"fictional-token",obtained_at:Date.now(),expires_in:3600}),webhookChannelId:"renew-me",webhookExpiresAt:new Date(Date.now()+3600000)}).returning();
  expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(1);expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(0);
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({id:"renew-me",expirationDateTime:expiresAt.toISOString()})));vi.stubGlobal("fetch",fetcher);
  await processCalendarSubscriptionQueue(1);
  expect(fetcher.mock.calls[0][1].method).toBe("PATCH");
  expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id)))[0].webhookExpiresAt).toEqual(expiresAt);
  expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(0);
 });
 it("requeues a stale cancelled renewal with current credentials",async()=>{
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId,provider:"microsoft",providerAccountId:crypto.randomUUID(),status:"active",encryptedCredentials:encryptCalendarSecret({access_token:"old-token",obtained_at:Date.now(),expires_in:3600}),webhookChannelId:"stale-renew",webhookExpiresAt:new Date(Date.now()+3600000)}).returning();
  expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(1);
  await db.update(calendarConnections).set({encryptedCredentials:encryptCalendarSecret({access_token:"new-token",obtained_at:Date.now(),expires_in:3600})}).where(eq(calendarConnections.id,connection.id));
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);expect(fetcher).not.toHaveBeenCalled();
  expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(1);
  fetcher.mockImplementation(async()=>new Response(JSON.stringify({id:"stale-renew",expirationDateTime:new Date(Date.now()+2*86400000).toISOString()})));await processCalendarSubscriptionQueue(1);
  expect(fetcher.mock.calls[0][1].headers.authorization).toBe("Bearer new-token");
 });
 it("recovers unknown subscription expiry without inventing a lifetime",async()=>{
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId,provider:"microsoft",providerAccountId:crypto.randomUUID(),status:"active",encryptedCredentials:encryptCalendarSecret({access_token:"unknown-lifetime-token"}),webhookChannelId:"unknown-expiry",webhookExpiresAt:null}).returning();
  expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(1);expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(0);
  const expiresAt=new Date(Date.now()+2*86400000);vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(JSON.stringify({id:"unknown-expiry",expirationDateTime:expiresAt.toISOString()}))));await processCalendarSubscriptionQueue(1);
  expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id)))[0].webhookExpiresAt).toEqual(expiresAt);
 });
 it("adopts a confirmed Google replacement and durably queues old-channel cleanup",async()=>{
  vi.stubEnv("APP_URL","https://surveynt.test");vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-webhook");
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId,provider:"google",providerAccountId:crypto.randomUUID(),status:"active",encryptedCredentials:encryptCalendarSecret({access_token:"replacement-token",obtained_at:Date.now(),expires_in:3600}),webhookChannelId:"old-channel",webhookResourceId:"old-resource",webhookExpiresAt:new Date(Date.now()+3600000)}).returning();
  expect(await enqueueGoogleSubscriptionReplacements()).toBe(1);
  const fetcher=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>{
   const body=JSON.parse(String(options.body));
   return new Response(JSON.stringify({id:body.id,resourceId:"new-resource",expiration:String(Date.now()+7*86400000)}));
  });vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);
  const [current]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,connection.id));expect(current.webhookChannelId).not.toBe("old-channel");expect(current.webhookResourceId).toBe("new-resource");
  fetcher.mockImplementation(async(_url:string,options:RequestInit)=>{expect(JSON.parse(String(options.body))).toEqual({id:"old-channel",resourceId:"old-resource"});return new Response(null,{status:204});});
  await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(2);expect(await enqueueGoogleSubscriptionReplacements()).toBe(0);
 });
 it("holds an uncertain Google creation without issuing another watch",async()=>{
  const [connection]=await db.insert(calendarConnections).values({organisationId,userId,provider:"google",providerAccountId:crypto.randomUUID(),status:"active",encryptedCredentials:encryptCalendarSecret({access_token:"uncertain-token",obtained_at:Date.now(),expires_in:3600}),webhookChannelId:"uncertain-old",webhookResourceId:"old-resource",webhookExpiresAt:new Date(Date.now()+3600000)}).returning();
  expect(await enqueueGoogleSubscriptionReplacements()).toBe(1);const fetcher=vi.fn().mockRejectedValue(new Error("lost watch response"));vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);
  const [job]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.deduplicationKey,`calendar-renew:${connection.id}:uncertain-old:${connection.webhookExpiresAt!.toISOString()}`));expect(job.status).toBe("failed");
  expect(decryptCalendarSecret<{phase:string}>(String(job.payload.encryptedCleanup)).phase).toBe("dispatched");
  await db.update(backgroundJobs).set({status:"queued",availableAt:new Date()}).where(eq(backgroundJobs.id,job.id));await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);expect((await read(job.id)).status).toBe("failed");expect(await enqueueGoogleSubscriptionReplacements()).toBe(0);
 });
 it("queues later due connections beyond one hundred existing held renewals",async()=>{
  const expiry=new Date(Date.now()+1800000);
  const connections=await db.insert(calendarConnections).values(Array.from({length:101},(_,index)=>({organisationId,userId,provider:"microsoft",providerAccountId:crypto.randomUUID(),status:"active",encryptedCredentials:encryptCalendarSecret({access_token:"fairness-token",obtained_at:Date.now(),expires_in:3600}),webhookChannelId:`fairness-${index}`,webhookExpiresAt:expiry}))).returning();
  await db.insert(backgroundJobs).values(connections.slice(0,100).map(connection=>({organisationId,queue:"calendar_subscription",type:"renew_webhook",status:"failed",deduplicationKey:`calendar-renew:${connection.id}:${connection.webhookChannelId}:${expiry.toISOString()}`,payload:{connectionId:connection.id}})));
  expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(1);expect(await enqueueMicrosoftSubscriptionRenewals()).toBe(0);
  const remaining=connections[100];await db.update(backgroundJobs).set({status:"failed"}).where(eq(backgroundJobs.deduplicationKey,`calendar-renew:${remaining.id}:${remaining.webhookChannelId}:${expiry.toISOString()}`));
 });
 it("rejects a payload connection substitution before provider access",async()=>{
  const {job}=await fixture();await db.update(backgroundJobs).set({payload:{...job.payload,connectionId:crypto.randomUUID()}}).where(eq(backgroundJobs.id,job.id));
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);expect((await read(job.id)).status).toBe("failed");expect(fetcher).not.toHaveBeenCalled();
 });
});
