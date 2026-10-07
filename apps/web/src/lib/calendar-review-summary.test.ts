import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {backgroundJobs} from "@surveynt/db";
import {encryptCalendarSecret} from "./calendar-oauth";
import {calendarReviewSummary,calendarReviewVersion} from "./calendar-review-summary";
const connectionId="1b15b9d0-8170-4937-84ab-9496926305ef",organisationId="5c076f09-5daf-4f0e-b4d2-bb88409eb76b";
beforeEach(()=>vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64")));
afterEach(()=>vi.unstubAllEnvs());
function job(){return {id:connectionId,organisationId,createdAt:new Date(),type:"replace_webhook",deduplicationKey:null,providerMessageId:null,availableAt:new Date(),lockedUntil:null,completedAt:null,failedAt:null,error:null,queue:"calendar_subscription",status:"failed",attempts:2,leaseToken:null,updatedAt:new Date(),payload:{connectionId,encryptedCleanup:encryptCalendarSecret({connectionId,organisationId,provider:"google",channelId:"channel",phase:"dispatched",tokens:{access_token:"private-token"},expectedCredentials:"private-credentials"})}} as typeof backgroundJobs.$inferSelect;}
describe("calendar operator review summary",()=>{
 it("exposes only safe metadata and a snapshot version",()=>{
  const row=job(),value=calendarReviewSummary(row);expect(value).toMatchObject({provider:"google",channelId:"channel",phase:"dispatched",attempts:2});expect(JSON.stringify(value)).not.toMatch(/private-token|private-credentials|encryptedCleanup/);expect(value?.reviewVersion).toHaveLength(64);
 });
 it("changes version when the attempt or encrypted evidence changes",()=>{
  const row=job();expect(calendarReviewVersion({...row,attempts:3})).not.toBe(calendarReviewVersion(row));expect(calendarReviewVersion({...row,payload:{connectionId}})).not.toBe(calendarReviewVersion(row));
 });
 it("leaves unavailable or mismatched evidence explicit",()=>{
  const row=job();expect(calendarReviewSummary({...row,organisationId:connectionId})?.phase).toBe("unavailable");expect(calendarReviewSummary({...row,payload:{}})?.phase).toBe("unavailable");
 });
 it("does not classify another queue as a calendar review",()=>expect(calendarReviewSummary({...job(),queue:"email"})).toBeNull());
});
