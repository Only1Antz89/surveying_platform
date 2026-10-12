import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({found:vi.fn(),current:vi.fn(),rows:[] as unknown[][],audit:vi.fn()}));
vi.mock("@/lib/firm-operations",()=>({readPublicQuote:state.found}));
vi.mock("@/lib/reports",()=>({currentReportInput:state.current}));
vi.mock("@surveynt/db",async original=>({...await original<typeof import("@surveynt/db")>(),createDatabase:()=>({}),withTenant:async(_db:unknown,_org:string,callback:(tx:unknown)=>unknown)=>callback({
  select:()=>{const chain={from:()=>chain,innerJoin:()=>chain,where:()=>chain,orderBy:()=>chain,limit:async()=>state.rows.shift()};return chain;},
  insert:()=>({values:async(value:unknown)=>state.audit(value)}),
})}));
import { GET } from "./route";
const route={params:Promise.resolve({id:"quote-1"})};
const request=new Request("http://surveynt.test/reports",{headers:{"x-quote-token":"client-secret"}});
function rows(approvedAt:string){return [[{id:"job-1",organisationId:"org-1",surveyFileArchiveUntil:new Date("2040-01-01Z")}],[{id:"survey-1"}],[{report:{id:"report-1",versionNumber:1,inputFingerprint:"current",content:{}},approvedAt:new Date(approvedAt)}]];}
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));state.found.mockResolvedValue({row:{id:"quote-1",jobId:"job-1",organisationId:"org-1"}});state.current.mockResolvedValue({fingerprint:"current"});});
afterEach(()=>vi.useRealTimers());
it("expires customer access exactly at one year despite a longer company archive",async()=>{
  state.rows=rows("2025-06-01T00:00:00Z");const response=await GET(request,route);
  expect(response.status).toBe(410);expect((await response.json()).error.code).toBe("report_access_expired");expect(state.audit).not.toHaveBeenCalled();
});
it("returns the customer deadline with an unchanged approved report",async()=>{
  state.rows=rows("2025-06-02T00:00:00Z");const response=await GET(request,route);
  expect(response.status).toBe(200);expect((await response.json()).data[0].accessExpiresAt).toBe("2026-06-02T00:00:00.000Z");
  expect(state.found).toHaveBeenCalledWith("quote-1","client-secret");
});
it("does not disclose reports through an invalid customer link",async()=>{
  state.found.mockResolvedValue(null);expect((await GET(request,route)).status).toBe(404);expect(state.current).not.toHaveBeenCalled();
});
it("does not disclose a report whose survey inputs changed",async()=>{
  state.rows=rows("2025-06-02T00:00:00Z");state.current.mockResolvedValue({fingerprint:"changed"});
  expect((await (await GET(request,route)).json()).data).toEqual([]);expect(state.audit).not.toHaveBeenCalled();
});
