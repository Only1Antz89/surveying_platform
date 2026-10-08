import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { and,eq,sql } from "drizzle-orm";
import { auditEvents,backgroundJobs,appointments,calendarConflicts,calendarEventLinks,clients,jobs,properties,availabilityBlocks,calendarConnections,organisations,organisationOperationalSettings,organisationMemberships,users,type Database } from "@surveynt/db";
import { createTestDatabase,integrationEnabled,stopRelay,type TestDatabase } from "@surveynt/db/testing";
const reviewer=vi.hoisted(()=>({organisationId:"",internalUserId:"",role:"owner",demo:false,accessLevel:"full"}));
vi.mock("server-only",()=>({}));
vi.mock("../src/lib/access",()=>({apiContext:async()=>reviewer,canWriteWorkspace:()=>true}));
vi.mock("../src/lib/workspace-api-guard",()=>({workspaceApiGuard:async()=>null}));
vi.mock("../src/lib/stakeholder-demo",()=>({isDemoOrganisation:async()=>false}));
import { GET as oauthCallback } from "../src/app/api/v1/calendar/oauth/callback/route";
import { POST as calendarWebhook } from "../src/app/api/webhooks/calendar/[provider]/route";
import { POST as connectionAction } from "../src/app/api/v1/me/calendar-connections/route";
import { POST as reviewConflict } from "../src/app/api/v1/calendar/conflicts/[id]/route";
import { calendarWebhookToken,decryptCalendarSecret,encryptCalendarSecret } from "../src/lib/calendar-oauth";
import {registerCalendarWebhookAttempt} from "../src/lib/calendar-registration-attempt";
import {processCalendarSubscriptionQueue} from "../src/lib/calendar-subscription-queue";
import { finishCalendarAttempt,recoverCalendarLeases } from "../src/lib/calendar-queue";
import { processCalendarQueue,reconcileCalendarConnection } from "../src/lib/calendar-sync";
const event=(id:string)=>({id,start:{dateTime:"2026-10-07T09:00:00Z"},end:{dateTime:"2026-10-07T10:00:00Z"}});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
describe.skipIf(!integrationEnabled)("complete calendar availability snapshots",()=>{
  let database:TestDatabase,db:Database,organisationId:string,userId:string;
  beforeAll(async()=>{
    database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("DATABASE_APP_URL",database.appUrl);vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));
    const [org]=await db.insert(organisations).values({clerkOrganisationId:"calendar-pages",slug:"calendar-pages",name:"Calendar pages",practiceType:"building_surveying",region:"Bristol",status:"active"}).returning();organisationId=org.id;
    const [user]=await db.insert(users).values({clerkUserId:"calendar-pages-user",email:"calendar@example.test",firstName:"Calendar",lastName:"Reviewer"}).returning();userId=user.id;await db.insert(organisationMemberships).values({organisationId,userId,role:"owner"});Object.assign(reviewer,{organisationId,internalUserId:userId});
  },120000);
  afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await database?.drop();await stopRelay();});
  async function connection(provider:string){const [row]=await db.insert(calendarConnections).values({organisationId,userId,provider,providerAccountId:crypto.randomUUID(),encryptedCredentials:encryptCalendarSecret({access_token:"fictional-token"})}).returning();return row;}
  async function blocks(id:string){return db.select().from(availabilityBlocks).where(and(eq(availabilityBlocks.organisationId,organisationId),eq(availabilityBlocks.source,`calendar:${id}`)));}
  it("persists busy events from every page for both providers",async()=>{
    for(const provider of ["google","microsoft"]){
      const row=await connection(provider);const fetcher=provider==="google"?vi.fn().mockResolvedValueOnce(json({items:[event("first")],nextPageToken:"second"})).mockResolvedValueOnce(json({items:[event("second"),{id:"cancelled",status:"cancelled"}]})):vi.fn().mockResolvedValueOnce(json({value:[event("first")],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=second"})).mockResolvedValueOnce(json({value:[event("second")]}));vi.stubGlobal("fetch",fetcher);
      expect(await reconcileCalendarConnection(row.id)).toMatchObject({importedBusy:2});expect((await blocks(row.id)).map(block=>block.externalEventId).sort()).toEqual(["first","second"]);
    }
  });
  it("exports local-only edits but holds competing provider edits",async()=>{
    for(const remoteVersion of ["remote-1","remote-2"]){
      const row=await connection("google");const [client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"Fictional calendar client"}).returning();
      const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"1 Fictional Road",city:"Bristol",postcode:"BS1 1AA"}).returning();
      const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey"}).returning();
      const original=new Date(Date.now()+86400000),local=new Date(original.getTime()+3600000);
      const [appointment]=await db.insert(appointments).values({organisationId,jobId:job.id,surveyorId:userId,startsAt:local,endsAt:new Date(local.getTime()+3600000),version:2}).returning();
      await db.insert(calendarEventLinks).values({organisationId,connectionId:row.id,appointmentId:appointment.id,externalEventId:"linked",externalVersion:"remote-1",lastSyncedAppointmentVersion:1});
      let patched=false;
      const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
        if(options.method==="PATCH"){expect((options.headers as Record<string,string>)["if-match"]).toBe("remote-1");patched=true;return json({});}
        const start=patched?local:original,remoteEvent={id:"linked",etag:patched?"remote-after-patch":remoteVersion,start:{dateTime:start.toISOString()},end:{dateTime:new Date(start.getTime()+3600000).toISOString()},extendedProperties:{private:{surveyntAppointmentId:appointment.id}}};
        return json(url.includes("/events?")?{items:[remoteEvent]}:remoteEvent);
      });vi.stubGlobal("fetch",fetcher);
      await reconcileCalendarConnection(row.id);
      const conflicts=await db.select().from(calendarConflicts).where(eq(calendarConflicts.connectionId,row.id));
      const patches=fetcher.mock.calls.filter(call=>call[1].method==="PATCH");
      expect(conflicts).toHaveLength(remoteVersion==="remote-1"?0:1);expect(patches).toHaveLength(remoteVersion==="remote-1"?1:0);
      if(remoteVersion==="remote-2"){
        const changedStart=new Date(original.getTime()-3600000);
        const responseFor=(start:Date,version:string)=>json({items:[{id:"linked",etag:version,start:{dateTime:start.toISOString()},end:{dateTime:new Date(start.getTime()+3600000).toISOString()},extendedProperties:{private:{surveyntAppointmentId:appointment.id}}}]});
        fetcher.mockImplementation(async(_url:string,options:RequestInit)=>options.method==="PATCH"?json({etag:"remote-after-patch"}):responseFor(changedStart,"remote-3"));
        await reconcileCalendarConnection(row.id);const [refreshed]=await db.select().from(calendarConflicts).where(eq(calendarConflicts.connectionId,row.id));expect(refreshed.id).toBe(conflicts[0].id);expect(refreshed.details).toMatchObject({externalVersion:"remote-3",externalStart:changedStart.toISOString(),appointmentVersion:2});
        fetcher.mockImplementation(async(_url:string,options:RequestInit)=>options.method==="PATCH"?json({etag:"remote-after-patch"}):responseFor(local,"remote-4"));
        await reconcileCalendarConnection(row.id);const [converged]=await db.select().from(calendarConflicts).where(eq(calendarConflicts.connectionId,row.id));expect(converged).toMatchObject({status:"resolved",resolvedByUserId:null});const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,converged.id));expect(audits).toHaveLength(1);expect(audits[0]).toMatchObject({action:"calendar.conflict_converged",actorUserId:null});
      }
      // Prevent another connection's later pass from attempting to export this fixture.
      await db.update(appointments).set({status:"cancelled"}).where(eq(appointments.id,appointment.id));
    }
  });
  it("recovers provider acceptance after a lost creation response without creating a second event",async()=>{
    const row=await connection("google");const [client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"Fictional retry client"}).returning();
    const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"2 Fictional Road",city:"Bristol",postcode:"BS1 1AA"}).returning();
    const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey"}).returning();
    const startsAt=new Date(Date.now()+86400000);const [appointment]=await db.insert(appointments).values({organisationId,jobId:job.id,surveyorId:userId,startsAt,endsAt:new Date(startsAt.getTime()+3600000)}).returning();
    let accepted:Record<string,unknown>|null=null,created=0;
    const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
      if(options.method==="POST"){
        const payload=JSON.parse(options.body as string) as Record<string,unknown>;
        if(accepted){expect(payload.id).toBe(accepted.id);return json({},409);}
        accepted={...payload,etag:"accepted-version"};created++;throw new Error("Lost creation response after provider acceptance");
      }
      return url.includes("/events?")?json({items:[]}):json(accepted);
    });vi.stubGlobal("fetch",fetcher);
    await expect(reconcileCalendarConnection(row.id)).rejects.toThrow("Lost creation response");expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId,row.id))).toHaveLength(0);
    expect(await reconcileCalendarConnection(row.id)).toMatchObject({exported:1});expect(created).toBe(1);expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId,row.id))).toHaveLength(1);
    await db.update(appointments).set({status:"cancelled"}).where(eq(appointments.id,appointment.id));
  });
  it("rejects an overlapping sync and releases the connection lock after failure",async()=>{
    const row=await connection("google");let entered!:()=>void,release!:()=>void;
    const reached=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
    const fetcher=vi.fn().mockImplementation(async()=>{entered();await held;throw new Error("Simulated provider failure");});vi.stubGlobal("fetch",fetcher);
    const first=reconcileCalendarConnection(row.id);const outcome=expect(first).rejects.toThrow("Simulated provider failure");
    await reached;
    try{await expect(reconcileCalendarConnection(row.id)).rejects.toThrow("already synchronising");expect(fetcher).toHaveBeenCalledTimes(1);}finally{release();}
    await outcome;vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>json({items:[]})));
    expect(await reconcileCalendarConnection(row.id)).toMatchObject({importedBusy:0});
  });
  it("recovers modern claims, fences old workers and holds ambiguous legacy claims",async()=>{
    const row=await connection("google"),past=new Date(Date.now()-600000),oldToken=crypto.randomUUID();
    const [modern,legacy,exhausted]=await db.insert(backgroundJobs).values([
      {organisationId,queue:"calendar",type:"calendar_reconcile",status:"processing",attempts:1,leaseToken:oldToken,lockedUntil:past,payload:{connectionId:row.id}},
      {organisationId,queue:"calendar",type:"calendar_reconcile",status:"processing",attempts:1,updatedAt:past,payload:{connectionId:row.id}},
      {organisationId,queue:"calendar",type:"calendar_reconcile",status:"processing",attempts:5,leaseToken:crypto.randomUUID(),lockedUntil:past,payload:{connectionId:row.id}}
    ]).returning();
    expect(await recoverCalendarLeases(db)).toBe(3);expect(await finishCalendarAttempt(db,modern.id,oldToken,{status:"completed"})).toBe(false);
    const held=await db.select().from(backgroundJobs).where(eq(backgroundJobs.queue,"calendar"));expect(held.find(job=>job.id===legacy.id)?.status).toBe("failed");expect(held.find(job=>job.id===exhausted.id)?.status).toBe("failed");
    const fetcher=vi.fn().mockImplementation(async()=>json({items:[]}));vi.stubGlobal("fetch",fetcher);await Promise.all([processCalendarQueue(),processCalendarQueue()]);expect(fetcher).toHaveBeenCalledTimes(1);
    const [done]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,modern.id));expect(done).toMatchObject({status:"completed",lockedUntil:null,attempts:2});expect(done.leaseToken).not.toBe(oldToken);expect(await finishCalendarAttempt(db,modern.id,oldToken,{status:"failed"})).toBe(false);
  });
  it("rejects a queue payload whose practice does not own the connection",async()=>{
    const row=await connection("google");const [job]=await db.insert(backgroundJobs).values({queue:"calendar",type:"calendar_reconcile",payload:{connectionId:row.id}}).returning();
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await processCalendarQueue();expect(fetcher).not.toHaveBeenCalled();const [current]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id));expect(current.error).toContain("does not belong");expect(current.status).toBe("queued");
  });
  it("exports an unsynced visit beyond the first 250 upcoming appointments",async()=>{
    const row=await connection("google");const [client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"Large fictional calendar"}).returning();
    const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"3 Fictional Road",city:"Bristol",postcode:"BS1 1AA"}).returning();
    const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey"}).returning();
    const base=Date.now()+86400000;
    const visits=await db.insert(appointments).values(Array.from({length:251},(_,index)=>({organisationId,jobId:job.id,surveyorId:userId,startsAt:new Date(base+index*3600000),endsAt:new Date(base+(index+1)*3600000)}))).returning();
    await db.insert(calendarEventLinks).values(visits.slice(0,250).map((visit,index)=>({organisationId,connectionId:row.id,appointmentId:visit.id,externalEventId:`existing-${index}`,externalVersion:"original",lastSyncedAppointmentVersion:1})));
    const fetcher=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>options.method==="POST"?json({id:JSON.parse(options.body as string).id,etag:"created"}):json({items:[]}));vi.stubGlobal("fetch",fetcher);
    expect(await reconcileCalendarConnection(row.id)).toMatchObject({exported:1,continuationRequired:false});expect(fetcher.mock.calls.filter(call=>call[1].method==="POST")).toHaveLength(1);
    const links=await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId,row.id));expect(links).toHaveLength(251);
    await db.update(appointments).set({status:"cancelled"}).where(eq(appointments.jobId,job.id));
  },30000);
  it("requeues a successful partial export and completes the remaining visits on the next claim",async()=>{
    const row=await connection("google");const [client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"Fictional batch calendar"}).returning();
    const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"4 Fictional Road",city:"Bristol",postcode:"BS1 1AA"}).returning();
    const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey"}).returning();
    let clock=Date.now();const base=clock+86400000;
    await db.insert(appointments).values([0,1].map(index=>({organisationId,jobId:job.id,surveyorId:userId,startsAt:new Date(base+index*3600000),endsAt:new Date(base+(index+1)*3600000)})));
    const [queued]=await db.insert(backgroundJobs).values({organisationId,queue:"calendar",type:"calendar_reconcile",payload:{connectionId:row.id}}).returning();
    let created=0;const fetcher=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>{
      if(options.method!=="POST")return json({items:[]});created++;if(created===1)clock+=41000;return json({id:JSON.parse(options.body as string).id,etag:"created"});
    });vi.stubGlobal("fetch",fetcher);const timer=vi.spyOn(Date,"now").mockImplementation(()=>clock);
    try{await processCalendarQueue();}finally{timer.mockRestore();}
    const [partial]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,queued.id));expect(partial).toMatchObject({status:"queued",attempts:0,completedAt:null});expect(created).toBe(1);
    const [connectionState]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id));expect(connectionState.lastSyncedAt).toBeNull();
    await processCalendarQueue();const [done]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,queued.id));expect(done.status).toBe("completed");expect(created).toBe(2);
    await db.update(appointments).set({status:"cancelled"}).where(eq(appointments.jobId,job.id));
  },30000);
  it("rejects stale review snapshots, changed appointments and restricted reviewers",async()=>{
    const row=await connection("google");const [client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"Fictional conflict reviewer"}).returning();
    const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"5 Fictional Road",city:"Bristol",postcode:"BS1 1AA"}).returning();
    const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey"}).returning();
    const start=new Date(Date.now()+86400000);const [appointment]=await db.insert(appointments).values({organisationId,jobId:job.id,surveyorId:userId,startsAt:start,endsAt:new Date(start.getTime()+3600000)}).returning();
    const [conflict]=await db.insert(calendarConflicts).values({organisationId,connectionId:row.id,appointmentId:appointment.id,kind:"external_time_changed",details:{appointmentVersion:1,externalVersion:"reviewed",externalEventId:"review-linked"}}).returning();
    await db.insert(calendarEventLinks).values({organisationId,connectionId:row.id,appointmentId:appointment.id,externalEventId:"review-linked",externalVersion:"original",lastSyncedAppointmentVersion:1});
    let restored=false,rejectPatch=false;const providerFetch=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>{
      if(options.method==="PATCH"){expect((options.headers as Record<string,string>)["if-match"]).toBe("reviewed");if(rejectPatch)return json({},412);restored=true;return json({});}
      return json({id:"review-linked",etag:restored?"restored":"reviewed",extendedProperties:{private:{surveyntAppointmentId:appointment.id}},start:{dateTime:new Date(start.getTime()+(restored?0:3600000)).toISOString()},end:{dateTime:new Date(start.getTime()+(restored?3600000:7200000)).toISOString()}});
    });vi.stubGlobal("fetch",providerFetch);
    const body={decision:"keep_surveynt",expectedUpdatedAt:conflict.updatedAt.toISOString(),expectedAppointmentVersion:1,expectedExternalVersion:"reviewed"};
    const call=(values:unknown)=>reviewConflict(new Request(`http://surveynt.test/api/v1/calendar/conflicts/${conflict.id}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(values)}),{params:Promise.resolve({id:conflict.id})});
    reviewer.role="finance";expect((await call(body)).status).toBe(403);reviewer.role="owner";
    expect((await call({decision:"keep_surveynt"})).status).toBe(400);
    expect((await call({...body,expectedExternalVersion:"older"})).status).toBe(409);expect((await call({...body,expectedUpdatedAt:new Date(conflict.updatedAt.getTime()-1).toISOString()})).status).toBe(409);
    await db.update(appointments).set({version:2}).where(eq(appointments.id,appointment.id));expect((await call(body)).status).toBe(409);
    expect((await db.select().from(calendarConflicts).where(eq(calendarConflicts.id,conflict.id)))[0].status).toBe("open");expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,conflict.id))).toHaveLength(0);
    for(const status of ["cancelled","completed"] as const){await db.update(appointments).set({version:1,status}).where(eq(appointments.id,appointment.id));expect((await call(body)).status).toBe(409);}
    reviewer.organisationId=crypto.randomUUID();expect((await call(body)).status).toBe(404);reviewer.organisationId=organisationId;
    await db.update(appointments).set({version:1,status:"provisional"}).where(eq(appointments.id,appointment.id));
    rejectPatch=true;expect((await call(body)).status).toBe(409);expect((await db.select().from(calendarConflicts).where(eq(calendarConflicts.id,conflict.id)))[0].status).toBe("open");expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId,conflict.id))).toHaveLength(0);rejectPatch=false;
    expect((await call(body)).ok).toBe(true);expect(restored).toBe(true);expect(providerFetch.mock.calls.filter(call=>call[1].method==="PATCH")).toHaveLength(2);const [savedLink]=await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId,row.id));expect(savedLink.externalVersion).toBe("restored");expect((await call(body)).status).toBe(409);
    const [cancelledReview]=await db.update(calendarConflicts).set({status:"open",kind:"external_cancelled",resolvedAt:null,resolvedByUserId:null,details:{appointmentVersion:1,externalVersion:"cancelled-revision",externalEventId:"review-linked"},updatedAt:new Date()}).where(eq(calendarConflicts.id,conflict.id)).returning();
    let replacement:Record<string,unknown>|null=null,created=0;
    const replacementFetch=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
      if(options.method==="POST"){
        if(replacement)return json({},409);
        const payload=JSON.parse(options.body as string);replacement={...payload,etag:"replacement-revision"};created++;throw new Error("Lost replacement response");
      }
      return url.endsWith("/review-linked")?json({},404):json(replacement);
    });vi.stubGlobal("fetch",replacementFetch);
    const cancellationBody={...body,expectedUpdatedAt:cancelledReview.updatedAt.toISOString(),expectedExternalVersion:"cancelled-revision"};
    expect((await call(cancellationBody)).status).toBe(502);expect((await db.select().from(calendarConflicts).where(eq(calendarConflicts.id,conflict.id)))[0].status).toBe("open");
    const replacementResult=await call(cancellationBody);expect(replacementResult.ok).toBe(true);expect(created).toBe(1);
    const [newLink]=await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId,row.id));expect(newLink.externalEventId).not.toBe("review-linked");expect(newLink.externalVersion).toBe("replacement-revision");
    const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,conflict.id));expect(audits).toHaveLength(2);expect(audits.find(event=>event.metadata.providerEventId===newLink.externalEventId)?.metadata).toMatchObject({previousEventId:"review-linked"});

    await db.update(appointments).set({status:"cancelled"}).where(eq(appointments.id,appointment.id));
  },30000);
  it("retains previous availability and sync timestamp when a later page fails",async()=>{
    const row=await connection("google");await db.insert(availabilityBlocks).values({organisationId,userId,source:`calendar:${row.id}`,kind:"external_busy",externalEventId:"retained",startsAt:new Date("2026-10-07T11:00:00Z"),endsAt:new Date("2026-10-07T12:00:00Z")});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(json({items:[event("partial")],nextPageToken:"later"})).mockResolvedValueOnce(new Response("provider failure",{status:503})));
    await expect(reconcileCalendarConnection(row.id)).rejects.toThrow("could not be read");expect((await blocks(row.id)).map(block=>block.externalEventId)).toEqual(["retained"]);const [current]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id));expect(current.lastSyncedAt).toBeNull();
  });
  it("accepts reviewed external times with normal availability checks and no provider write",async()=>{
    const weekdays=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    await db.insert(organisationOperationalSettings).values({organisationId,workingDays:weekdays,workingHours:Object.fromEntries(weekdays.map(day=>[day,{start:"00:00",end:"23:59"}])),travelBufferMinutes:0,bookingHorizonDays:90}).onConflictDoUpdate({target:organisationOperationalSettings.organisationId,set:{workingDays:weekdays,travelBufferMinutes:0,bookingHorizonDays:90,workingHours:Object.fromEntries(weekdays.map(day=>[day,{start:"00:00",end:"23:59"}]))}});
    for(const [index,provider] of ["google","microsoft"].entries()){
      const row=await connection(provider);const [client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"External choice client"}).returning();
      const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"External choice road",city:"Bristol",postcode:"BS1 1AA"}).returning();
      const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey",stage:"scheduled"}).returning();
      const start=new Date(Date.now()+80*86400000);start.setUTCHours(9+index*3,0,0,0);const end=new Date(start.getTime()+3600000),oldStart=new Date(start.getTime()-3600000);
      const [visit]=await db.insert(appointments).values({organisationId,jobId:job.id,surveyorId:userId,status:"confirmed",startsAt:oldStart,endsAt:start}).returning();
      await db.insert(calendarEventLinks).values({organisationId,connectionId:row.id,appointmentId:visit.id,externalEventId:"external-choice",externalVersion:"prior",lastSyncedAppointmentVersion:1});
      const [conflict]=await db.insert(calendarConflicts).values({organisationId,connectionId:row.id,appointmentId:visit.id,kind:"external_time_changed",details:{externalEventId:"external-choice",externalVersion:"reviewed",appointmentVersion:1,externalStart:start.toISOString(),externalEnd:end.toISOString()}}).returning();
      const fetcher=vi.fn().mockImplementation(async()=>json({id:"external-choice",...(provider==="google"?{etag:"reviewed",extendedProperties:{private:{surveyntAppointmentId:visit.id}}}:{changeKey:"reviewed",categories:[`surveynt:${visit.id}`]}),start:{dateTime:start.toISOString()},end:{dateTime:end.toISOString()}}));vi.stubGlobal("fetch",fetcher);
      const call=()=>reviewConflict(new Request("http://surveynt.test/conflict",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:"accept_external",expectedUpdatedAt:conflict.updatedAt.toISOString(),expectedAppointmentVersion:1,expectedExternalVersion:"reviewed"})}),{params:Promise.resolve({id:conflict.id})});
      const [block]=await db.insert(availabilityBlocks).values({organisationId,userId,startsAt:start,endsAt:end,source:"manual",reason:"Reviewed closure"}).returning();
      expect((await call()).status).toBe(409);expect((await db.select().from(appointments).where(eq(appointments.id,visit.id)))[0].version).toBe(1);expect((await db.select().from(calendarConflicts).where(eq(calendarConflicts.id,conflict.id)))[0].status).toBe("open");
      await db.delete(availabilityBlocks).where(eq(availabilityBlocks.id,block.id));expect((await call()).status).toBe(200);
      expect((await db.select().from(appointments).where(eq(appointments.id,visit.id)))[0]).toMatchObject({startsAt:start,endsAt:end,version:2,status:"confirmed"});
      expect((await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.appointmentId,visit.id)))[0]).toMatchObject({externalVersion:"reviewed",lastSyncedAppointmentVersion:2});
      expect((await call()).status).toBe(409);expect(fetcher.mock.calls.every(call=>!call[1].method)).toBe(true);
      const audits=await db.select().from(auditEvents).where(eq(auditEvents.resourceId,conflict.id));expect(audits).toHaveLength(1);expect(audits[0].metadata.decision).toBe("accept_external");
      await db.update(appointments).set({status:"cancelled"}).where(eq(appointments.id,visit.id));
    }
  });
  it("accepts a verified external cancellation and returns the final visit job to instructed",async()=>{
    const row=await connection("google"),[client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"Cancellation choice client"}).returning();
    const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"Cancel choice road",city:"Bristol",postcode:"BS1 1AA"}).returning();
    const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey",stage:"scheduled",targetDate:"2026-11-01"}).returning();
    const start=new Date(Date.now()+86400000),[visit]=await db.insert(appointments).values({organisationId,jobId:job.id,surveyorId:userId,status:"confirmed",startsAt:start,endsAt:new Date(start.getTime()+3600000)}).returning();
    await db.insert(calendarEventLinks).values({organisationId,connectionId:row.id,appointmentId:visit.id,externalEventId:"cancel-choice",externalVersion:"prior",lastSyncedAppointmentVersion:1});
    const [conflict]=await db.insert(calendarConflicts).values({organisationId,connectionId:row.id,appointmentId:visit.id,kind:"external_cancelled",details:{externalEventId:"cancel-choice",externalVersion:"cancelled-version",appointmentVersion:1,externalStart:null,externalEnd:null}}).returning();
    const fetcher=vi.fn().mockResolvedValue(json({id:"cancel-choice",status:"cancelled",etag:"cancelled-version"}));vi.stubGlobal("fetch",fetcher);
    const result=await reviewConflict(new Request("http://surveynt.test/conflict",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:"accept_external",expectedUpdatedAt:conflict.updatedAt.toISOString(),expectedAppointmentVersion:1,expectedExternalVersion:"cancelled-version"})}),{params:Promise.resolve({id:conflict.id})});
    expect(result.status).toBe(200);expect((await db.select().from(appointments).where(eq(appointments.id,visit.id)))[0]).toMatchObject({status:"cancelled",version:2});
    expect((await db.select().from(jobs).where(eq(jobs.id,job.id)))[0]).toMatchObject({stage:"instructed",targetDate:null});expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("holds late provider revisions and conditional PATCH races without advancing the link",async()=>{
    for(const race of ["read","patch"]){
      const row=await connection("google"),[client]=await db.insert(clients).values({organisationId,kind:"individual",displayName:"Export race client"}).returning();
      const [property]=await db.insert(properties).values({organisationId,clientId:client.id,line1:"Race road",city:"Bristol",postcode:"BS1 1AA"}).returning();
      const [job]=await db.insert(jobs).values({organisationId,clientId:client.id,propertyId:property.id,reference:crypto.randomUUID(),serviceName:"Survey"}).returning();
      const original=new Date(Date.now()+2*86400000),local=new Date(original.getTime()+3600000);
      const [visit]=await db.insert(appointments).values({organisationId,jobId:job.id,surveyorId:userId,startsAt:local,endsAt:new Date(local.getTime()+3600000),version:2}).returning();
      const [link]=await db.insert(calendarEventLinks).values({organisationId,connectionId:row.id,appointmentId:visit.id,externalEventId:"race-event",externalVersion:"remote-1",lastSyncedAppointmentVersion:1}).returning();
      const remote=(version:string)=>({id:"race-event",etag:version,start:{dateTime:original.toISOString()},end:{dateTime:new Date(original.getTime()+3600000).toISOString()},extendedProperties:{private:{surveyntAppointmentId:visit.id}}});
      const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
        if(options.method==="PATCH"){expect((options.headers as Record<string,string>)["if-match"]).toBe("remote-1");return json({},412);}
        return json(url.includes("/events?")?{items:[remote("remote-1")]}:remote(race==="read"?"remote-2":"remote-1"));
      });vi.stubGlobal("fetch",fetcher);expect(await reconcileCalendarConnection(row.id)).toMatchObject({updated:0,continuationRequired:false});
      expect((await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.id,link.id)))[0]).toMatchObject({externalVersion:"remote-1",lastSyncedAppointmentVersion:1});
      const conflicts=await db.select().from(calendarConflicts).where(eq(calendarConflicts.connectionId,row.id));expect(conflicts).toHaveLength(1);expect(conflicts[0]).toMatchObject({status:"open",kind:"export_review_required"});
      expect(fetcher.mock.calls.filter(call=>call[1].method==="PATCH")).toHaveLength(race==="read"?0:1);
      expect((await db.select().from(auditEvents).where(eq(auditEvents.resourceId,conflicts[0].id)))[0].action).toBe("calendar.export_review_required");
      await db.update(appointments).set({status:"cancelled"}).where(eq(appointments.id,visit.id));
    }
  });

  it("cannot persist refreshed credentials after a connection is revoked or reconnected",async()=>{
    for(const outcome of ["revoked","reconnected"]){
      const row=await connection("google"),expired=encryptCalendarSecret({access_token:"expired-token",refresh_token:"fictional-refresh",expires_in:1,obtained_at:Date.now()-60000});
      await db.update(calendarConnections).set({encryptedCredentials:expired}).where(eq(calendarConnections.id,row.id));
      const replacement=outcome==="revoked"?"":encryptCalendarSecret({access_token:"new-connection-token"});
      const fetcher=vi.fn().mockImplementation(async()=>{
        await db.update(calendarConnections).set({status:outcome==="revoked"?"revoked":"active",encryptedCredentials:replacement}).where(eq(calendarConnections.id,row.id));
        return json({access_token:"late-refreshed-token",refresh_token:"late-refresh",expires_in:3600});
      });vi.stubGlobal("fetch",fetcher);
      await expect(reconcileCalendarConnection(row.id)).rejects.toThrow("connection changed during refresh");
      const [saved]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id));expect(saved.encryptedCredentials).toBe(replacement);expect(fetcher).toHaveBeenCalledTimes(1);
      if(outcome==="reconnected")expect(decryptCalendarSecret(saved.encryptedCredentials)).toEqual({access_token:"new-connection-token"});
    }
  });

  it("holds disconnect during reconciliation and wipes credentials once the lock is released",async()=>{
    const row=await connection("google");let ready!:()=>void,release!:()=>void;
    const acquired=new Promise<void>(resolve=>{ready=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
    const lock=db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`calendar-sync:${row.id}`},0))`);ready();await held;});
    await acquired;
    const call=()=>connectionAction(new Request("http://surveynt.test/api/v1/me/calendar-connections",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:row.id,action:"disconnect"})}));
    try{expect((await call()).status).toBe(409);expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id)))[0]).toMatchObject({status:"active",encryptedCredentials:row.encryptedCredentials});}finally{release();await lock;}
    expect((await call()).status).toBe(200);expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id)))[0]).toMatchObject({status:"revoked",encryptedCredentials:"",syncCursor:null});
  });

  it("queues subsequent Microsoft edits to the same event after an earlier notification completed",async()=>{
    vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-notification-secret");const row=await connection("microsoft");
    await db.update(calendarConnections).set({webhookChannelId:"fictional-subscription"}).where(eq(calendarConnections.id,row.id));
    const request=()=>new Request("http://surveynt.test/api/webhooks/calendar/microsoft",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({value:[{subscriptionId:"fictional-subscription",clientState:calendarWebhookToken(row.id),resourceData:{id:"same-event"}},{subscriptionId:"fictional-subscription",clientState:calendarWebhookToken(row.id),resourceData:{id:"same-event"}}]})});
    const call=()=>calendarWebhook(request(),{params:Promise.resolve({provider:"microsoft"})});
    for(const value of [[null],[{subscriptionId:123,clientState:"invalid"}]])expect((await calendarWebhook(new Request("http://surveynt.test/webhook",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({value})}),{params:Promise.resolve({provider:"microsoft"})})).status).toBe(400);
    expect((await call()).status).toBe(202);
    let queued=await db.select().from(backgroundJobs).where(eq(backgroundJobs.organisationId,organisationId));queued=queued.filter(item=>item.payload.connectionId===row.id);expect(queued).toHaveLength(1);
    await db.update(backgroundJobs).set({status:"completed",completedAt:new Date()}).where(eq(backgroundJobs.id,queued[0].id));
    expect((await call()).status).toBe(202);
    const events=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.organisationId,organisationId))).filter(item=>item.payload.connectionId===row.id);expect(events).toHaveLength(2);expect(new Set(events.map(item=>item.deduplicationKey)).size).toBe(2);
  });

  it("rewraps an active connection under the new key without a provider refresh and audits only key versions",async()=>{
    const row=await connection("google");vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION","2");vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64"));vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_PREVIOUS_KEYS",JSON.stringify({1:Buffer.alloc(32,7).toString("base64")}));
    const fetcher=vi.fn().mockImplementation(async()=>json({items:[]}));vi.stubGlobal("fetch",fetcher);
    try{
      await reconcileCalendarConnection(row.id);const [saved]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id));expect(saved.encryptedCredentials).toMatch(/^v2\.2\./);expect(saved.encryptionKeyVersion).toBe(2);expect(decryptCalendarSecret(saved.encryptedCredentials)).toEqual({access_token:"fictional-token"});
      const audits=await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,row.id),eq(auditEvents.action,"calendar.credentials_reencrypted")));expect(audits).toHaveLength(1);expect(audits[0].metadata).toEqual({previousKeyVersion:1,keyVersion:2,source:"calendar_reconciliation"});expect(JSON.stringify(audits)).not.toContain("fictional-token");expect(fetcher).toHaveBeenCalledTimes(1);
      await reconcileCalendarConnection(row.id);expect(await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,row.id),eq(auditEvents.action,"calendar.credentials_reencrypted")))).toHaveLength(1);
    }finally{vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION","1");vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_PREVIOUS_KEYS","{}");}
  });

  it("persists the confirmed Google channel resource identity through the authenticated callback",async()=>{
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","fictional-client");vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET","fictional-secret");vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-webhook-secret");
    const providerAccountId=crypto.randomUUID(),expiresAt=new Date(Date.now()+60000);
    const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
      if(url.includes("/token"))return json({access_token:"fictional-callback-token",expires_in:3600});
      if(url.includes("userinfo"))return json({sub:providerAccountId,email:"fictional-provider@example.test"});
      return json({id:JSON.parse(String(options.body)).id,resourceId:"confirmed-google-resource",expiration:String(expiresAt.getTime())});
    });vi.stubGlobal("fetch",fetcher);
    const state=encryptCalendarSecret({provider:"google",organisationId,userId,verifier:"a".repeat(64),expires:Date.now()+60000});
    const url=new URL("http://surveynt.test/api/v1/calendar/oauth/callback");url.searchParams.set("state",state);url.searchParams.set("code","fictional-code");
    const response=await oauthCallback(new Request(url));expect(response.headers.get("location")).toContain("calendar=connected");
    const [saved]=await db.select().from(calendarConnections).where(eq(calendarConnections.providerAccountId,providerAccountId));expect(saved).toMatchObject({userId,organisationId,webhookResourceId:"confirmed-google-resource",webhookExpiresAt:expiresAt});
  });

  it("queues exact prior-channel cleanup on reconnect and clears stale subscription fields",async()=>{
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","fictional-client");vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET","fictional-secret");vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-webhook-secret");
    for(const watchFails of [false,true]){
      const row=await connection("google"),oldChannel=crypto.randomUUID();let newChannel="";
      await db.update(calendarConnections).set({webhookChannelId:oldChannel,webhookResourceId:"old-resource",webhookExpiresAt:new Date(Date.now()+3600000)}).where(eq(calendarConnections.id,row.id));
      const key=`calendar-stop:${row.id}:${oldChannel}`;
      await db.insert(backgroundJobs).values({organisationId,queue:"calendar_subscription",type:"stop_webhook",status:"failed",deduplicationKey:key,payload:{connectionId:row.id},attempts:5});
      const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
        if(url.includes("/token"))return json({access_token:"fresh-reconnect-token",expires_in:3600});
        if(url.includes("userinfo"))return json({sub:row.providerAccountId,email:"reconnect@example.test"});
        if(url.includes("channels/stop")){expect(JSON.parse(String(options.body))).toEqual({id:oldChannel,resourceId:"old-resource"});expect((options.headers as Record<string,string>).authorization).toBe("Bearer fresh-reconnect-token");return new Response(null,{status:204});}
        newChannel=JSON.parse(String(options.body)).id;return watchFails?json({},503):json({id:newChannel,resourceId:"new-resource",expiration:String(Date.now()+86400000)});
      });vi.stubGlobal("fetch",fetcher);
      const state=encryptCalendarSecret({provider:"google",organisationId,userId,verifier:"a".repeat(64),expires:Date.now()+60000}),url=new URL("http://surveynt.test/api/v1/calendar/oauth/callback");url.searchParams.set("state",state);url.searchParams.set("code","reconnect-code");
      expect((await oauthCallback(new Request(url))).headers.get("location")).toContain("calendar=connected");
      const [saved]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id));expect(saved.webhookChannelId).toBe(watchFails?null:newChannel);expect(saved.webhookResourceId).toBe(watchFails?null:"new-resource");if(watchFails)expect(saved.webhookExpiresAt).toBeNull();
      const [cleanup]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.deduplicationKey,key));expect(cleanup).toMatchObject({status:"queued",attempts:0});expect(decryptCalendarSecret(cleanup.payload.encryptedCleanup as string)).toMatchObject({channelId:oldChannel,resourceId:"old-resource",tokens:{access_token:"fresh-reconnect-token"}});
      await processCalendarSubscriptionQueue(1);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,cleanup.id)))[0].status).toBe("completed");
    }
  });

  it("queues cleanup of a confirmed channel that cannot be adopted after connection revocation",async()=>{
    const providerAccountId=crypto.randomUUID();let channelId="";
    const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
      if(url.includes("/token"))return json({access_token:"race-token",expires_in:3600});
      if(url.includes("userinfo"))return json({sub:providerAccountId,email:"race@example.test"});
      const [current]=await db.select().from(calendarConnections).where(eq(calendarConnections.providerAccountId,providerAccountId));
      await db.update(calendarConnections).set({status:"revoked",encryptedCredentials:""}).where(eq(calendarConnections.id,current.id));
      channelId=JSON.parse(String(options.body)).id;return json({id:channelId,resourceId:"unadopted-resource",expiration:String(Date.now()+86400000)});
    });vi.stubGlobal("fetch",fetcher);
    const state=encryptCalendarSecret({provider:"google",organisationId,userId,verifier:"a".repeat(64),expires:Date.now()+60000}),url=new URL("http://surveynt.test/api/v1/calendar/oauth/callback");url.searchParams.set("state",state);url.searchParams.set("code","race-code");
    await oauthCallback(new Request(url));
    const [saved]=await db.select().from(calendarConnections).where(eq(calendarConnections.providerAccountId,providerAccountId));expect(saved).toMatchObject({status:"revoked",encryptedCredentials:"",webhookChannelId:null});
    const [cleanup]=await db.select().from(backgroundJobs).where(eq(backgroundJobs.deduplicationKey,`calendar-stop:${saved.id}:${channelId}`));expect(cleanup.status).toBe("queued");expect(decryptCalendarSecret(String(cleanup.payload.encryptedCleanup))).toMatchObject({channelId,resourceId:"unadopted-resource",tokens:{access_token:"race-token"}});
  });

  it("records initial creation before dispatch and holds lost responses for both providers",async()=>{
    vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-webhook-secret");
    for(const provider of ["google","microsoft"]){
      const row=await connection(provider);
      const fetcher=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>{
        const attempts=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===row.id);expect(attempts).toHaveLength(1);expect(attempts[0].status).toBe("processing");
        const snapshot=decryptCalendarSecret<{phase:string;channelId:string|null;registrationAttemptId:string;clientState:string|null}>(String(attempts[0].payload.encryptedCleanup));expect(snapshot.phase).toBe("dispatched");if(provider==="google")expect(snapshot.channelId).toBe(JSON.parse(String(options.body)).id);else {expect(snapshot.channelId).toBeNull();expect(JSON.parse(String(options.body)).clientState).toBe(calendarWebhookToken(row.id,snapshot.registrationAttemptId));expect(snapshot.clientState).toBe(JSON.parse(String(options.body)).clientState);}
        throw new Error("lost provider creation response");
      });vi.stubGlobal("fetch",fetcher);
      await expect(registerCalendarWebhookAttempt(db,row,{access_token:"initial-token"},"https://surveynt.test")).rejects.toThrow("requires provider review");
      const [held]=(await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===row.id);expect(held.status).toBe("failed");
      await db.update(backgroundJobs).set({status:"processing",leaseToken:crypto.randomUUID(),lockedUntil:new Date(Date.now()-1000),availableAt:new Date(Date.now()-10000)}).where(eq(backgroundJobs.id,held.id));
      await processCalendarSubscriptionQueue(1);expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,held.id)))[0].status).toBe("failed");
    }
  });

  it("allows one initial dispatch and rejects stale or unresolved registration attempts",async()=>{
    vi.stubEnv("CALENDAR_WEBHOOK_SECRET","single-registration-proof");
    for(const provider of ["google","microsoft"]){
      const row=await connection(provider),fetcher=vi.fn().mockRejectedValue(new Error("lost creation response"));vi.stubGlobal("fetch",fetcher);
      const outcomes=await Promise.allSettled([registerCalendarWebhookAttempt(db,row,{access_token:"token"},"https://surveynt.test"),registerCalendarWebhookAttempt(db,row,{access_token:"token"},"https://surveynt.test")]);
      expect(outcomes.every(result=>result.status==="rejected")).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(registerCalendarWebhookAttempt(db,row,{access_token:"token"},"https://surveynt.test")).rejects.toThrow("requires provider review");expect(fetcher).toHaveBeenCalledTimes(1);
      const stale=await connection(provider);await db.update(calendarConnections).set({encryptedCredentials:encryptCalendarSecret({access_token:"replacement-token"})}).where(eq(calendarConnections.id,stale.id));
      await expect(registerCalendarWebhookAttempt(db,stale,{access_token:"old-token"},"https://surveynt.test")).rejects.toThrow("connection changed");expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("reconnects credentials without creating another subscription while initial registration is unresolved",async()=>{
    vi.stubEnv("CALENDAR_WEBHOOK_SECRET","reconnect-hold-proof");vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","fictional-client");vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET","fictional-secret");
    const row=await connection("google");vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("lost watch response")));
    await expect(registerCalendarWebhookAttempt(db,row,{access_token:"old-token"},"http://surveynt.test")).rejects.toThrow();
    const fetcher=vi.fn().mockImplementation(async(url:string)=>url.includes("/token")?json({access_token:"fresh-held-token",expires_in:3600}):json({sub:row.providerAccountId,email:"held@example.test"}));vi.stubGlobal("fetch",fetcher);
    const state=encryptCalendarSecret({provider:"google",organisationId,userId,verifier:"a".repeat(64),expires:Date.now()+60000}),url=new URL("http://surveynt.test/api/v1/calendar/oauth/callback");url.searchParams.set("state",state);url.searchParams.set("code","held-reconnect-code");
    const response=await oauthCallback(new Request(url));expect(response.headers.get("location")).toContain("calendar=review_required");expect(fetcher).toHaveBeenCalledTimes(2);
    const [saved]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id));expect(saved.webhookChannelId).toBeNull();expect(decryptCalendarSecret(saved.encryptedCredentials)).toMatchObject({access_token:"fresh-held-token"});expect(saved.lastError).toContain("earlier calendar registration");
    expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.type,"register_webhook"))).filter(job=>job.payload.connectionId===row.id)).toHaveLength(1);
  });

  it("recovers confirmed initial registration without repeating creation for either provider",async()=>{
    for(const provider of ["google","microsoft"]){
      const row=await connection(provider),channelId=crypto.randomUUID(),expiresAt=new Date(Date.now()+86400000);
      const [job]=await db.insert(backgroundJobs).values({organisationId,queue:"calendar_subscription",type:"register_webhook",status:"processing",attempts:1,leaseToken:crypto.randomUUID(),lockedUntil:new Date(Date.now()-1000),availableAt:new Date(Date.now()-10000),payload:{connectionId:row.id,encryptedCleanup:encryptCalendarSecret({connectionId:row.id,organisationId,userId,provider,providerAccountId:row.providerAccountId,channelId,expectedCredentials:row.encryptedCredentials,tokens:{access_token:"recovery-token"},phase:"confirmed",confirmed:{channelId,resourceId:provider==="google"?"recovery-resource":null,expiresAt:expiresAt.toISOString()}})}}).returning();
      const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await processCalendarSubscriptionQueue(1);expect(fetcher).not.toHaveBeenCalled();
      expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id)))[0]).toMatchObject({webhookChannelId:channelId,webhookExpiresAt:expiresAt});expect((await db.select().from(backgroundJobs).where(eq(backgroundJobs.id,job.id)))[0]).toMatchObject({status:"completed",payload:{connectionId:row.id}});
    }
  });

  it("persists Microsoft attempt identity and accepts notifications only for that proof",async()=>{
    vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-attempt-webhook");
    const row=await connection("microsoft"),subscriptionId=crypto.randomUUID();let proof="";
    vi.stubGlobal("fetch",vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>{proof=JSON.parse(String(options.body)).clientState;return json({id:subscriptionId,expirationDateTime:new Date(Date.now()+86400000).toISOString()});}));
    await registerCalendarWebhookAttempt(db,row,{access_token:"attempt-token"},"https://surveynt.test");
    const [saved]=await db.select().from(calendarConnections).where(eq(calendarConnections.id,row.id));expect(saved.webhookAttemptId).not.toBeNull();expect(proof).toBe(calendarWebhookToken(row.id,saved.webhookAttemptId!));
    async function notify(clientState:string){return calendarWebhook(new Request("https://surveynt.test/api/webhooks/calendar/microsoft",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({value:[{subscriptionId,clientState,resourceData:{id:"attempt-event"}}]})}),{params:Promise.resolve({provider:"microsoft"})});}
    await notify(calendarWebhookToken(row.id));await notify(calendarWebhookToken(row.id,crypto.randomUUID()));
    const rows=()=>db.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue,"calendar"),sql`${backgroundJobs.payload}->>'connectionId'=${row.id}`));
    expect(await rows()).toHaveLength(0);expect((await notify(proof)).status).toBe(202);expect(await rows()).toHaveLength(1);
  });

});
