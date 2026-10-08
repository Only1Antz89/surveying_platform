import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { and,eq,sql } from "drizzle-orm";
import { auditEvents,organisationMemberships,organisations,platformStaff,users,type Database } from "@surveynt/db";
import { createTestDatabase,integrationEnabled,stopRelay,type TestDatabase } from "@surveynt/db/testing";
import { Webhook } from "svix";
const session=vi.hoisted(()=>({userId:"user_profile_audit" as string|null}));
vi.mock("@clerk/nextjs/server",()=>({auth:async()=>({userId:session.userId})}));
vi.mock("../src/lib/access",()=>({isClerkConfigured:()=>true}));
import { PATCH as settings } from "../src/app/api/v1/me/route";
import { GET as history } from "../src/app/api/v1/me/history/route";
import { POST } from "../src/app/api/webhooks/clerk/route";
const secret=`whsec_${Buffer.from("fictional-profile-test-secret").toString("base64")}`;
const profile={updated_at:1791280000000,id:"user_profile_audit",first_name:"Alex",last_name:"Surveyor",primary_email_address_id:"email_profile",email_addresses:[{id:"email_profile",email_address:"profile@example.test",verification:{status:"verified"}}]};
function request(eventId:string,data:unknown,type="user.updated"){
  const payload=JSON.stringify({type,data}),now=new Date();
  return new Request("https://surveynt.test/api/webhooks/clerk",{method:"POST",body:payload,headers:{"svix-id":eventId,"svix-timestamp":String(Math.floor(now.getTime()/1000)),"svix-signature":new Webhook(secret).sign(eventId,now,payload)}});
}
describe.skipIf(!integrationEnabled)("verified global account profile audit",()=>{
  let database:TestDatabase,db:Database;
  beforeAll(async()=>{database=await createTestDatabase();db=database.connect(database.adminUrl);vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);vi.stubEnv("DATABASE_APP_URL",database.appUrl);vi.stubEnv("CLERK_WEBHOOK_SECRET",secret);vi.stubEnv("PLATFORM_SUPER_ADMIN_EMAILS","");},120000);
  afterAll(async()=>{vi.unstubAllEnvs();await database?.drop();await stopRelay();});
  it("persists a signed profile update and creates deduplicated source evidence",async()=>{
    expect((await POST(request("msg_profile_create",profile,"user.created"))).status).toBe(200);
    const [account]=await db.select().from(users).where(eq(users.clerkUserId,profile.id));expect(account.firstName).toBe("Alex");
    const changed={...profile,updated_at:profile.updated_at+1,first_name:"Morgan"};
    expect((await POST(request("msg_profile_update",changed))).status).toBe(200);
    expect((await POST(request("msg_profile_update",changed))).status).toBe(200);
    expect((await POST(request("msg_profile_unchanged",changed))).status).toBe(200);
    const rows=await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,account.id),eq(auditEvents.action,"account.profile_synchronised")));
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({actorUserId:null,organisationId:null});
    expect(rows[0].metadata).toMatchObject({source:"verified_clerk_webhook",providerEventId:"msg_profile_update",changedFields:["firstName"]});
    expect(JSON.stringify(rows[0].metadata)).not.toContain("profile@example.test");
    expect((await db.select().from(users).where(eq(users.id,account.id)))[0].firstName).toBe("Morgan");
  });
  it("rejects an unsigned update without changing profile or audit",async()=>{
    const before=await db.select().from(auditEvents);
    const response=await POST(new Request("https://surveynt.test/api/webhooks/clerk",{method:"POST",body:JSON.stringify({type:"user.updated",data:{...profile,first_name:"Unverified"}})}));
    expect(response.status).toBe(400);expect(await db.select().from(auditEvents)).toHaveLength(before.length);
    expect((await db.select().from(users).where(eq(users.clerkUserId,profile.id)))[0].firstName).toBe("Morgan");
  });
  it("keeps the canonical profile when membership events carry older names or identifiers",async()=>{
    const organisation={id:"org_profile_membership",name:"Profile membership practice",slug:"profile-membership"};
    expect((await POST(request("msg_profile_org",organisation,"organization.created"))).status).toBe(200);
    const membership={role:"org:member",public_metadata:{role:"surveyor"},organization:{id:organisation.id},public_user_data:{user_id:profile.id,identifier:"old@example.test",first_name:"Old",last_name:"Snapshot"}};
    expect((await POST(request("msg_profile_member",membership,"organizationMembership.updated"))).status).toBe(200);
    const [account]=await db.select().from(users).where(eq(users.clerkUserId,profile.id));
    expect(account).toMatchObject({email:"profile@example.test",firstName:"Morgan",lastName:"Surveyor"});
    const [practice]=await db.select().from(organisations).where(eq(organisations.clerkOrganisationId,organisation.id));
    expect((await db.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,practice.id),eq(organisationMemberships.userId,account.id))))[0].active).toBe(true);
    const missing={...membership,public_user_data:{...membership.public_user_data,user_id:"user_seeded_membership",identifier:"seeded@example.test",first_name:"Seeded"}};
    expect((await POST(request("msg_profile_seed",missing,"organizationMembership.created"))).status).toBe(200);
    const [seeded]=await db.select().from(users).where(eq(users.clerkUserId,"user_seeded_membership"));expect(seeded.email).toBe("seeded@example.test");
    const audits=await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,seeded.id),eq(auditEvents.action,"account.created")));expect(audits).toHaveLength(1);expect(audits[0].metadata.source).toBe("verified_clerk_membership_webhook");
  });

  it("ignores older and equal revisions and rejects missing provider revisions",async()=>{
    for(const revision of [profile.updated_at,profile.updated_at+1])expect((await POST(request(`msg_profile_old_${revision}`,{...profile,updated_at:revision,first_name:"Old value"}))).status).toBe(200);
    vi.stubEnv("PLATFORM_SUPER_ADMIN_EMAILS","old-admin@example.test");
    expect((await POST(request("msg_profile_stale_privilege",{...profile,updated_at:profile.updated_at,email_addresses:[{id:"email_profile",email_address:"old-admin@example.test",verification:{status:"verified"}}]}))).status).toBe(200);
    expect(await db.select().from(platformStaff).where(eq(platformStaff.clerkUserId,profile.id))).toHaveLength(0);
    const {updated_at:omitted,...unversioned}=profile;void omitted;
    expect((await POST(request("msg_profile_missing_revision",{...unversioned,first_name:"Missing revision"}))).status).toBe(500);
    expect((await db.select().from(users).where(eq(users.clerkUserId,profile.id)))[0].firstName).toBe("Morgan");
    expect((await POST(request("msg_profile_newest",{...profile,updated_at:profile.updated_at+2,first_name:"Newest"}))).status).toBe(200);
    const [account]=await db.select().from(users).where(eq(users.clerkUserId,profile.id));expect(account.firstName).toBe("Newest");expect(account.clerkProfileUpdatedAt?.getTime()).toBe(profile.updated_at+2);
  });

  it("returns only the signed-in account history and omits raw provider metadata",async()=>{
    const [other]=await db.insert(users).values({clerkUserId:"user_other_history",email:"other-history@example.test"}).returning();
    await db.insert(auditEvents).values({action:"account.created",resourceType:"user",resourceId:other.id,metadata:{changedFields:["firstName"],providerEventId:"private-other-event"}});
    session.userId=null;expect((await history()).status).toBe(401);
    session.userId=profile.id;const own=await (await history()).json();expect(own.data.length).toBeGreaterThan(0);expect(JSON.stringify(own)).not.toContain("private-other-event");expect(JSON.stringify(own)).not.toContain("providerEventId");
    session.userId="user_other_history";const theirs=await (await history()).json();expect(theirs.data).toHaveLength(1);expect(theirs.data[0].action).toBe("account.created");session.userId=profile.id;
  });

  it("audits global personal settings and enforces self-only immutable audit access",async()=>{
    session.userId=profile.id;
    expect((await settings(new Request("https://surveynt.test/api/v1/me",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({notifications:{reminders:false}})}))).status).toBe(200);
    const [account]=await db.select().from(users).where(eq(users.clerkUserId,profile.id));
    const audits=await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,account.id),eq(auditEvents.action,"account.settings_updated")));expect(audits).toHaveLength(1);expect(audits[0]).toMatchObject({organisationId:null,actorUserId:account.id});
    const app=database.connect(database.appUrl),[other]=await db.select().from(users).where(eq(users.clerkUserId,"user_other_history"));
    await app.transaction(async tx=>{await tx.execute(sql`select set_config('app.current_user_id',${account.id},true)`);expect(await tx.select().from(auditEvents).where(eq(auditEvents.resourceId,other.id))).toHaveLength(0);});
    await expect(app.transaction(async tx=>{await tx.execute(sql`select set_config('app.current_user_id',${account.id},true)`);await tx.insert(auditEvents).values({action:"account.settings_updated",resourceType:"user",resourceId:other.id,actorUserId:account.id});})).rejects.toThrow();
    await expect(app.transaction(async tx=>{await tx.execute(sql`select set_config('app.current_user_id',${account.id},true)`);await tx.insert(auditEvents).values({action:"platform.privilege_granted",resourceType:"user",resourceId:account.id,actorUserId:account.id});})).rejects.toThrow();
    await app.transaction(async tx=>{await tx.execute(sql`select set_config('app.current_user_id',${account.id},true)`);expect(await tx.delete(auditEvents).where(eq(auditEvents.id,audits[0].id)).returning()).toHaveLength(0);});
    expect(await db.select().from(auditEvents).where(eq(auditEvents.id,audits[0].id))).toHaveLength(1);
    const own=await (await history()).json();expect(own.data.some((row:{action:string})=>row.action==="account.settings_updated")).toBe(true);
  });

  it("audits photo changes and removal without exposing image identifiers or accepting older snapshots",async()=>{
    const photo={...profile,updated_at:profile.updated_at+3,has_image:true,image_url:"https://images.example.test/private-photo-one"};
    expect((await POST(request("msg_profile_photo",photo))).status).toBe(200);
    const [account]=await db.select().from(users).where(eq(users.clerkUserId,profile.id));expect(account.clerkProfileImageFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const photoAudits=async()=> (await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId,account.id),eq(auditEvents.action,"account.profile_synchronised")))).filter(row=>Array.isArray(row.metadata.changedFields)&&row.metadata.changedFields.includes("photo"));
    expect(await photoAudits()).toHaveLength(1);
    expect((await POST(request("msg_profile_photo_repeat",{...photo,updated_at:photo.updated_at+1}))).status).toBe(200);
    expect(await photoAudits()).toHaveLength(1);
    expect((await POST(request("msg_profile_photo_old",{...photo,updated_at:photo.updated_at-1,image_url:"https://images.example.test/older-photo"}))).status).toBe(200);
    expect((await db.select().from(users).where(eq(users.id,account.id)))[0].clerkProfileImageFingerprint).toBe(account.clerkProfileImageFingerprint);
    expect((await POST(request("msg_profile_photo_removed",{...photo,updated_at:photo.updated_at+2,has_image:false}))).status).toBe(200);
    expect(await photoAudits()).toHaveLength(2);
    const removed=(await db.select().from(users).where(eq(users.id,account.id)))[0].clerkProfileImageFingerprint;
    expect((await POST(request("msg_profile_photo_legacy",{...profile,updated_at:photo.updated_at+3}))).status).toBe(200);
    expect((await db.select().from(users).where(eq(users.id,account.id)))[0].clerkProfileImageFingerprint).toBe(removed);
    const {image_url:omittedImage,...invalidPhoto}=photo;void omittedImage;
    expect((await POST(request("msg_profile_photo_missing",{...invalidPhoto,updated_at:photo.updated_at+4}))).status).toBe(500);
    expect((await db.select().from(users).where(eq(users.id,account.id)))[0].clerkProfileImageFingerprint).toBe(removed);
    expect((await POST(request("msg_profile_photo_replaced",{...photo,updated_at:photo.updated_at+5,image_url:"https://images.example.test/replacement-photo"}))).status).toBe(200);
    expect(await photoAudits()).toHaveLength(3);
    session.userId=profile.id;const own=await (await history()).json();expect(own.data.some((row:{changedFields:string[]})=>row.changedFields.includes("photo"))).toBe(true);
    expect(JSON.stringify(await photoAudits())).not.toContain("private-photo-one");expect(JSON.stringify(own)).not.toContain(removed);
  });

});
