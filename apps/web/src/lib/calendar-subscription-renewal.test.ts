import {afterEach,describe,expect,it,vi} from "vitest";
import {renewMicrosoftSubscription} from "./calendar-subscription";
afterEach(()=>vi.unstubAllGlobals());
describe("Microsoft subscription renewal",()=>{
 it("renews only the encoded recorded subscription and returns confirmed expiry",async()=>{
  const expiresAt=new Date(Date.now()+2*86400000);const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"channel/one",expirationDateTime:expiresAt.toISOString()})));vi.stubGlobal("fetch",fetcher);
  expect(await renewMicrosoftSubscription("fictional-token","channel/one")).toEqual({channelId:"channel/one",expiresAt});
  expect(fetcher).toHaveBeenCalledWith("https://graph.microsoft.com/v1.0/subscriptions/channel%2Fone",expect.objectContaining({method:"PATCH",redirect:"error",signal:expect.any(AbortSignal)}));
  const payload=JSON.parse(fetcher.mock.calls[0][1].body);expect(Object.keys(payload)).toEqual(["expirationDateTime"]);
 });
 it.each([
  {id:"other",expirationDateTime:new Date(Date.now()+86400000).toISOString()},
  {id:"channel",expirationDateTime:"invalid"},
  {id:"channel",expirationDateTime:new Date(Date.now()-1000).toISOString()},
  {id:"channel",expirationDateTime:new Date(Date.now()+10*86400000).toISOString()},
  {id:"channel"},
 ])("holds unconfirmed identity or expiry %j",async body=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));await expect(renewMicrosoftSubscription("token","channel")).rejects.toMatchObject({reviewRequired:true});
 });
 it("retries uncertain renewal without creating a second subscription",async()=>{
  const fetcher=vi.fn().mockRejectedValue(new Error("private provider response"));vi.stubGlobal("fetch",fetcher);await expect(renewMicrosoftSubscription("token","channel")).rejects.toMatchObject({reviewRequired:false});expect(fetcher.mock.calls[0][1].method).toBe("PATCH");
 });
 it("requires review for a missing subscription",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:404})));await expect(renewMicrosoftSubscription("token","channel")).rejects.toMatchObject({reviewRequired:true});
 });
});
