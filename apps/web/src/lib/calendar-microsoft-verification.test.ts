import {afterEach,describe,expect,it,vi} from "vitest";
import {verifyMicrosoftCalendarSubscription} from "./calendar-microsoft-verification";
afterEach(()=>vi.unstubAllGlobals());
const expected={subscriptionId:"proposed/id",providerAccountId:"provider-owner",applicationId:"application",notificationUrl:"https://surveynt.test/api/webhooks/calendar/microsoft",clientState:"attempt-specific-proof"};
const body=()=>({id:expected.subscriptionId,applicationId:expected.applicationId,resource:"me/events",notificationUrl:expected.notificationUrl,clientState:expected.clientState,changeType:"created,updated,deleted",expirationDateTime:new Date(Date.now()+2*86400000).toISOString()});
const json=(value:unknown)=>new Response(JSON.stringify(value));
describe("exact Microsoft subscription verification",()=>{
 it("checks account ownership before reading the encoded proposed record",async()=>{
  const subscription=body(),fetcher=vi.fn().mockResolvedValueOnce(json({id:expected.providerAccountId})).mockResolvedValueOnce(json(subscription));vi.stubGlobal("fetch",fetcher);
  expect(await verifyMicrosoftCalendarSubscription("fictional-token",expected)).toEqual({channelId:expected.subscriptionId,resourceId:null,expiresAt:new Date(subscription.expirationDateTime)});
  expect(fetcher.mock.calls[1][0]).toBe("https://graph.microsoft.com/v1.0/subscriptions/proposed%2Fid");for(const call of fetcher.mock.calls){expect(call[1].redirect).toBe("error");expect(call[1].signal).toBeInstanceOf(AbortSignal);}
 });
 it("rejects another account without reading its proposed subscription",async()=>{
  const fetcher=vi.fn().mockResolvedValue(json({id:"other-owner"}));vi.stubGlobal("fetch",fetcher);await expect(verifyMicrosoftCalendarSubscription("token",expected)).rejects.toMatchObject({reviewRequired:true});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each([{id:"other"},{applicationId:"other-app"},{resource:"me/messages"},{notificationUrl:"https://other.test/webhook"},{clientState:"other-attempt"},{clientState:undefined},{changeType:"created"},{expirationDateTime:new Date(Date.now()-1).toISOString()}])("rejects mismatched provider evidence %j",async mismatch=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(json({id:expected.providerAccountId})).mockResolvedValueOnce(json({...body(),...mismatch})));await expect(verifyMicrosoftCalendarSubscription("token",expected)).rejects.toMatchObject({reviewRequired:true});
 });
 it("holds absent, denied or unreadable provider evidence",async()=>{
  for(const status of [401,404,503]){vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status})));await expect(verifyMicrosoftCalendarSubscription("token",expected)).rejects.toMatchObject({reviewRequired:true});}
 });
});
