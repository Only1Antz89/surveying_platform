import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {backgroundJobs,calendarConnections,organisations,users,type Database} from "@surveynt/db";
import {createTestDatabase,integrationEnabled,stopRelay,type TestDatabase} from "@surveynt/db/testing";
import {loadCalendarQueueHealth} from "../src/lib/calendar-queue-health";
describe.skipIf(!integrationEnabled)("calendar queue health",()=>{
 let database:TestDatabase,db:Database,organisationId:string,userId:string;
 beforeAll(async()=>{database=await createTestDatabase();db=database.connect(database.adminUrl);const [org]=await db.insert(organisations).values({clerkOrganisationId:"health",slug:"health",name:"Health",practiceType:"building_surveying",region:"Bristol",status:"active"}).returning();organisationId=org.id;const [user]=await db.insert(users).values({clerkUserId:"health-owner",email:"health@example.test",firstName:"Health",lastName:"Owner"}).returning();userId=user.id;},120000);
 afterAll(async()=>{await database?.drop();await stopRelay();});
 it("reports empty configured state without inventing activity",async()=>{expect(await loadCalendarQueueHealth(db)).toMatchObject({ready:0,delayed:0,processing:0,expiredClaims:0,held:0,oldestReadyAt:null,missingChannels:0,expiredSubscriptions:0,dueSubscriptions:0});});
 it("separates queue timing, claims, held attempts and active channel deadlines without exposing payloads",async()=>{
  const now=new Date("2026-10-07T12:00:00Z"),past=new Date(now.getTime()-60000),future=new Date(now.getTime()+60000);
  for(const row of [{status:"queued",availableAt:past},{status:"queued",availableAt:future},{status:"processing",lockedUntil:past},{status:"processing",lockedUntil:future},{status:"failed"},{status:"completed"}])await db.insert(backgroundJobs).values({organisationId,queue:"calendar_subscription",type:"stop_webhook",payload:{private:"secret-token"},...row});
  await db.insert(backgroundJobs).values({organisationId,queue:"email",type:"send",status:"failed",payload:{}});
  for(const row of [{status:"active",webhookChannelId:null},{status:"active",webhookChannelId:"expired",webhookExpiresAt:past},{status:"active",webhookChannelId:"unknown",webhookExpiresAt:null},{status:"active",webhookChannelId:"future",webhookExpiresAt:new Date(now.getTime()+2*86400000)},{status:"revoked",webhookChannelId:null}])await db.insert(calendarConnections).values({organisationId,userId,provider:"google",providerAccountId:crypto.randomUUID(),encryptedCredentials:"private-credentials",...row});
  const health=await loadCalendarQueueHealth(db,now);expect(health).toEqual({checkedAt:now.toISOString(),ready:1,delayed:1,processing:2,expiredClaims:1,held:1,oldestReadyAt:past.toISOString(),missingChannels:1,expiredSubscriptions:1,dueSubscriptions:2});expect(JSON.stringify(health)).not.toMatch(/secret-token|private-credentials/);
 });
});
