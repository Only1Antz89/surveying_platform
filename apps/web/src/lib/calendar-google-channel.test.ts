import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createGoogleReplacementChannel} from "./calendar-google-channel";
const channelId="ecbf6187-c61f-4099-ad5a-45a65a583102";
const confirmed=()=>({id:channelId,resourceId:"provider-resource",expiration:String(Date.now()+7*86400000)});
beforeEach(()=>vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-webhook-secret"));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("Google replacement channel creation",()=>{
 it("uses the recorded attempt identity and returns only confirmed metadata",async()=>{
  const body=confirmed(),fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));vi.stubGlobal("fetch",fetcher);
  expect(await createGoogleReplacementChannel("connection","fictional-token","https://surveynt.test",channelId)).toEqual({channelId,resourceId:body.resourceId,expiresAt:new Date(Number(body.expiration))});
  const request=fetcher.mock.calls[0][1];expect(request.redirect).toBe("error");expect(request.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(request.body)).toMatchObject({id:channelId,address:"https://surveynt.test/api/webhooks/calendar/google",params:{ttl:"604800"}});
 });
 it.each(["http://surveynt.test","https://user:password@surveynt.test","https://surveynt.test/path","https://surveynt.test?url=other"])("rejects invalid origin %s before dispatch",async origin=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await expect(createGoogleReplacementChannel("connection","token",origin,channelId)).rejects.toMatchObject({reviewRequired:true});expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([
  {...confirmed(),id:"other"},
  {...confirmed(),resourceId:undefined},
  {...confirmed(),expiration:undefined},
  {...confirmed(),expiration:"invalid"},
  {...confirmed(),expiration:String(Date.now()-1000)},
 ])("holds unconfirmed metadata %j",async body=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));await expect(createGoogleReplacementChannel("connection","token","https://surveynt.test",channelId)).rejects.toMatchObject({reviewRequired:true});
 });
 it("holds a lost creation response instead of retrying with a new channel",async()=>{
  const fetcher=vi.fn().mockRejectedValue(new Error("lost response"));vi.stubGlobal("fetch",fetcher);await expect(createGoogleReplacementChannel("connection","token","https://surveynt.test",channelId)).rejects.toMatchObject({reviewRequired:true});expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
