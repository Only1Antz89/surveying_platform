import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {calendarWebhookToken,validCalendarWebhookToken,encryptCalendarSecret,exchangeCalendarCode,registerCalendarWebhook} from "./calendar-oauth";
const identity={organisationId:"practice",userId:"member"};
const state=()=>({...identity,provider:"google",verifier:"a".repeat(64),expires:Date.now()+60000});
const json=(body:unknown)=>new Response(JSON.stringify(body));
beforeEach(()=>{vi.stubEnv("CALENDAR_TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64"));vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","fictional-client");vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET","fictional-secret");vi.stubEnv("CALENDAR_WEBHOOK_SECRET","fictional-webhook-secret");});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("calendar OAuth boundaries",()=>{
 it("rejects user and practice mismatch before consuming the provider code",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  for(const owner of [{...identity,userId:"other"},{...identity,organisationId:"other"}])await expect(exchangeCalendarCode(encryptCalendarSecret(state()),"code","https://surveynt.test",owner)).rejects.toThrow("IDENTITY_MISMATCH");
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("rejects expired or malformed state before provider access",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  for(const value of [{...state(),expires:Date.now()-1},{...state(),provider:"unknown"},{...state(),verifier:"short"}])await expect(exchangeCalendarCode(encryptCalendarSecret(value),"code","https://surveynt.test",identity)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("bounds token exchange and account reads and retains the matched owner",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(json({access_token:"fictional-token",expires_in:3600})).mockResolvedValueOnce(json({sub:"provider-account",email:"fictional@example.test"}));vi.stubGlobal("fetch",fetcher);
  expect(await exchangeCalendarCode(encryptCalendarSecret(state()),"code","https://surveynt.test",identity)).toMatchObject({state:identity,providerAccountId:"provider-account"});
  for(const call of fetcher.mock.calls){expect(call[1].redirect).toBe("error");expect(call[1].signal).toBeInstanceOf(AbortSignal);}
 });
 it("bounds subscription registration for both providers",async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>json({id:"subscription",expiration:String(Date.now()+60000),expirationDateTime:new Date(Date.now()+60000).toISOString()}));vi.stubGlobal("fetch",fetcher);
  for(const provider of ["google","microsoft"] as const)expect(await registerCalendarWebhook(provider,"connection","token","https://surveynt.test")).toMatchObject({channelId:"subscription"});
  for(const call of fetcher.mock.calls){expect(call[1].redirect).toBe("error");expect(call[1].signal).toBeInstanceOf(AbortSignal);}
 });
 it("retains Google's resource identity and leaves legacy missing identities explicit",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(json({id:"channel",resourceId:"watched-resource",expiration:String(Date.now()+60000)})).mockResolvedValueOnce(json({id:"legacy-channel",expiration:String(Date.now()+60000)}));vi.stubGlobal("fetch",fetcher);
  expect(await registerCalendarWebhook("google","connection","token","https://surveynt.test")).toMatchObject({channelId:"channel",resourceId:"watched-resource"});
  expect(await registerCalendarWebhook("google","connection","token","https://surveynt.test")).toMatchObject({channelId:"legacy-channel",resourceId:null});
 });

 it("does not invent subscription expiry when the provider omits or corrupts it",async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>json({id:"channel",expiration:"not-a-date",expirationDateTime:"not-a-date"}));vi.stubGlobal("fetch",fetcher);
  for(const provider of ["google","microsoft"] as const)expect(await registerCalendarWebhook(provider,"connection","token","https://surveynt.test")).toMatchObject({expiresAt:null});
  fetcher.mockImplementation(async()=>json({id:"channel"}));
  for(const provider of ["google","microsoft"] as const)expect(await registerCalendarWebhook(provider,"connection","token","https://surveynt.test")).toMatchObject({expiresAt:null});
 });

 it("requires initial Google registration to return its durably recorded channel",async()=>{
  const recorded="6c4a5d52-38db-4abf-bb3a-70fe520b2b78";
  const fetcher=vi.fn().mockImplementation(async()=>json({id:"different-channel",resourceId:"resource",expiration:String(Date.now()+60000)}));vi.stubGlobal("fetch",fetcher);
  await expect(registerCalendarWebhook("google","connection","token","https://surveynt.test",recorded)).rejects.toThrow("registration failed");expect(JSON.parse(fetcher.mock.calls[0][1].body).id).toBe(recorded);
 });

 it("binds new Microsoft proofs to one attempt without accepting legacy downgrade",()=>{
  const first="6c4a5d52-38db-4abf-bb3a-70fe520b2b78",second="ccdf0e32-7f2e-4368-9904-5d2a30a7d568",proof=calendarWebhookToken("connection",first);
  expect(validCalendarWebhookToken("connection",proof,first)).toBe(true);expect(validCalendarWebhookToken("connection",proof,second)).toBe(false);expect(validCalendarWebhookToken("connection",calendarWebhookToken("connection"),first)).toBe(false);expect(validCalendarWebhookToken("connection",calendarWebhookToken("connection"))).toBe(true);
 });

});
