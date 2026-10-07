import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {backgroundJobs} from "@surveynt/db";
import {decryptCalendarSecret,encryptCalendarSecret} from "./calendar-oauth";
import {calendarReviewVersion} from "./calendar-review-summary";
import {calendarOutcomeSchema,reviewedCalendarOutcome} from "./calendar-provider-outcome";
const connectionId="1b15b9d0-8170-4937-84ab-9496926305ef",organisationId="5c076f09-5daf-4f0e-b4d2-bb88409eb76b",replacementChannelId="21c494af-6ef5-4231-b1fd-3b4f9d87371d";
beforeEach(()=>vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64")));afterEach(()=>vi.unstubAllEnvs());
function job(type="replace_webhook",phase="dispatched"):typeof backgroundJobs.$inferSelect{return {id:connectionId,organisationId,createdAt:new Date(),type,deduplicationKey:null,providerMessageId:null,availableAt:new Date(),lockedUntil:null,completedAt:null,failedAt:new Date(),error:"held",queue:"calendar_subscription",status:"failed",attempts:2,leaseToken:null,updatedAt:new Date(),payload:{connectionId,encryptedCleanup:encryptCalendarSecret({connectionId,organisationId,userId:connectionId,provider:"google",channelId:"old-channel",replacementChannelId,phase,tokens:{access_token:"private-token"},expectedCredentials:"ciphertext"})}};}
function input(row:typeof backgroundJobs.$inferSelect,outcome:"retry"|"removed"|"replacement_confirmed"|"replacement_not_created"|"cleanup_identity_verified"|"registration_confirmed"|"registration_not_created"="replacement_not_created"){return {reviewVersion:calendarReviewVersion(row),outcome,verifiedChannelId:row.type==="replace_webhook"?replacementChannelId:"old-channel",evidence:"Provider evidence reference checked by operator",confirmed:true as const};}
describe("reviewed calendar provider outcomes",()=>{
 it("requires an explicit confirmation and substantive evidence",()=>{expect(calendarOutcomeSchema.safeParse({...input(job()),confirmed:false}).success).toBe(false);expect(calendarOutcomeSchema.safeParse({...input(job()),evidence:"short"}).success).toBe(false);});
 it("rejects stale snapshots and jobs claimed by a worker",()=>{const row=job();expect(()=>reviewedCalendarOutcome({...row,attempts:3},input(row))).toThrow("Reload");expect(()=>reviewedCalendarOutcome({...row,status:"processing"},input(row))).toThrow("Reload");});
 it("rejects evidence for a different channel",()=>{const row=job();expect(()=>reviewedCalendarOutcome(row,{...input(row),verifiedChannelId:"other"})).toThrow("recorded attempt");});
 it("cannot blindly retry an uncertain creation",()=>{const row=job();expect(()=>reviewedCalendarOutcome(row,input(row,"retry"))).toThrow("uncertain creation");});
 it("retries confirmed non-creation using the same recorded attempt identity",()=>{const row=job(),outcome=reviewedCalendarOutcome(row,input(row));expect(outcome.status).toBe("queued");expect(decryptCalendarSecret(outcome.payload.encryptedCleanup!)).toMatchObject({phase:"ready",replacementChannelId});});
 it("records a confirmed resource and expiry for worker adoption",()=>{const row=job(),expiresAt=new Date(Date.now()+86400000).toISOString(),outcome=reviewedCalendarOutcome(row,{...input(row,"replacement_confirmed"),resourceId:"provider-resource",expiresAt});expect(decryptCalendarSecret(outcome.payload.encryptedCleanup!)).toMatchObject({phase:"confirmed",confirmed:{channelId:replacementChannelId,resourceId:"provider-resource",expiresAt}});});
 it("rejects expired or missing confirmed metadata",()=>{const row=job();expect(()=>reviewedCalendarOutcome(row,input(row,"replacement_confirmed"))).toThrow("future expiry");expect(()=>reviewedCalendarOutcome(row,{...input(row,"replacement_confirmed"),resourceId:"resource",expiresAt:new Date(Date.now()-1).toISOString()})).toThrow("future expiry");});
 it("clears encrypted credentials only for verified cleanup absence",()=>{const row=job("stop_webhook"),outcome=reviewedCalendarOutcome(row,input(row,"removed"));expect(outcome).toMatchObject({status:"completed",payload:{connectionId}});expect(JSON.stringify(outcome)).not.toContain("encryptedCleanup");const replacement=job();expect(()=>reviewedCalendarOutcome(replacement,input(replacement,"removed"))).toThrow("Only a cleanup");});
 it("fills a missing cleanup resource only after exact channel review",()=>{
  const row=job("stop_webhook"),outcome=reviewedCalendarOutcome(row,{...input(row,"cleanup_identity_verified"),resourceId:"verified-resource"});
  expect(decryptCalendarSecret(outcome.payload.encryptedCleanup!)).toMatchObject({resourceId:"verified-resource",channelId:"old-channel"});expect(outcome.status).toBe("queued");
 });
 it("cannot replace known resource evidence or use identity review on creation",()=>{
  const row=job("stop_webhook");const snapshot=decryptCalendarSecret<Record<string,unknown>>(String(row.payload.encryptedCleanup));row.payload.encryptedCleanup=encryptCalendarSecret({...snapshot,resourceId:"known-resource"});
  expect(()=>reviewedCalendarOutcome(row,{...input(row,"cleanup_identity_verified"),resourceId:"different-resource"})).toThrow("differs");
  const creation=job();expect(()=>reviewedCalendarOutcome(creation,{...input(creation,"cleanup_identity_verified"),resourceId:"resource"})).toThrow("recorded Google cleanup");
 });

 it("allows initial-registration adoption retry only for recorded confirmed responses",()=>{
  const confirmed=job("register_webhook","confirmed");expect(reviewedCalendarOutcome(confirmed,input(confirmed,"retry")).status).toBe("queued");
  const uncertain=job("register_webhook","dispatched");expect(()=>reviewedCalendarOutcome(uncertain,input(uncertain,"retry"))).toThrow("confirmed registration");
 });

 it("settles uncertain initial Google creation using its recorded channel and provider metadata",()=>{
  const row=job("register_webhook","dispatched"),expiresAt=new Date(Date.now()+86400000).toISOString();
  const outcome=reviewedCalendarOutcome(row,{...input(row,"registration_confirmed"),resourceId:"initial-resource",expiresAt});
  expect(decryptCalendarSecret(outcome.payload.encryptedCleanup!)).toMatchObject({phase:"confirmed",confirmed:{channelId:"old-channel",resourceId:"initial-resource",expiresAt}});
 });

 it("settles verified initial non-creation for both providers without another creation",()=>{
  const attempt="3af1ad5d-f98f-43e1-8c87-e0c7d805e5b3";
  for(const provider of ["google","microsoft"]){
   const row=job("register_webhook","dispatched"),snapshot=decryptCalendarSecret<Record<string,unknown>>(String(row.payload.encryptedCleanup));row.payload.encryptedCleanup=encryptCalendarSecret({...snapshot,provider,registrationAttemptId:attempt,channelId:provider==="google"?"old-channel":null});
   const reviewed={...input(row,"registration_not_created"),verifiedAttemptId:attempt,verifiedChannelId:provider==="google"?"old-channel":attempt};
   expect(reviewedCalendarOutcome(row,reviewed)).toMatchObject({status:"cancelled",payload:{connectionId}});
   expect(()=>reviewedCalendarOutcome(row,{...reviewed,verifiedAttemptId:replacementChannelId})).toThrow("exact recorded");
  }
 });
 it("cannot settle a confirmed registration as never created",()=>{
  const row=job("register_webhook","confirmed");expect(()=>reviewedCalendarOutcome(row,input(row,"registration_not_created"))).toThrow("exact recorded");
 });

});
