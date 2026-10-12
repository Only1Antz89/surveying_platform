import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({context:{organisationId:"00000000-0000-4000-8000-000000000001",internalUserId:"owner-1",role:"owner",demo:false},writable:true,rows:[] as unknown[][],read:vi.fn(),update:vi.fn(),audit:vi.fn()}));
vi.mock("@/lib/access",()=>({apiContext:async()=>state.context,canWriteWorkspace:()=>state.writable}));
vi.mock("@/lib/workspace-api-guard",()=>({workspaceApiGuard:async()=>null}));
vi.mock("@/lib/survey-file-retention-register",()=>({readSurveyFileRetention:state.read}));
vi.mock("@surveynt/db",async original=>({...await original<typeof import("@surveynt/db")>(),createDatabase:()=>({}),withTenant:async(_db:unknown,_org:string,callback:(tx:unknown)=>unknown)=>callback({
  select:()=>({from:()=>({where:()=>({for:async()=>state.rows.shift(),limit:async()=>state.rows.shift()})})}),
  update:()=>({set:(value:unknown)=>{state.update(value);return {where:async()=>undefined};}}),
  insert:()=>({values:async(value:unknown)=>state.audit(value)}),
})}));
import { POST } from "./route";
const id="00000000-0000-4000-8000-000000000002";
const version="a".repeat(64);
const route={params:Promise.resolve({id})};
const request=(change={})=>new Request("http://surveynt.test/archive",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reviewVersion:version,archiveUntil:"2100-01-01",reason:"Company requested a longer evidence archive.",...change})});
beforeEach(()=>{vi.clearAllMocks();Object.assign(state.context,{role:"owner",demo:false});state.writable=true;state.rows=[[{userId:"owner-1",role:"owner"}],[{id,version:3}],[]];state.read.mockResolvedValue({assessment:{reviewVersion:version,retentionUntil:new Date("2090-01-01Z")}});});
it("extends company retention and invalidates prior review without extending customer access",async()=>{
  const response=await POST(request(),route);expect(response.status).toBe(200);
  expect(state.update).toHaveBeenCalledWith(expect.objectContaining({version:4,surveyFileArchiveUntil:new Date("2100-01-01T23:59:59.999Z")}));
  expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({metadata:expect.objectContaining({customerAccessExtended:false})}));
});
it("rejects stale reviews, shortened dates and already started removal",async()=>{
  state.read.mockResolvedValueOnce({assessment:{reviewVersion:"b".repeat(64)}});expect((await POST(request(),route)).status).toBe(409);
  state.rows=[[{userId:"owner-1",role:"owner"}],[{id,version:3}],[]];expect((await POST(request({archiveUntil:"2080-01-01"}),route)).status).toBe(422);
  state.rows=[[{userId:"owner-1",role:"owner"}],[{id,version:3}],[{id:"removal"}]];expect((await POST(request(),route)).status).toBe(409);
  expect(state.update).not.toHaveBeenCalled();
});
it("checks current management membership and write access",async()=>{
  state.rows=[[{userId:"owner-1",role:"surveyor"}]];expect((await POST(request(),route)).status).toBe(403);
  state.writable=false;expect((await POST(request(),route)).status).toBe(403);expect(state.update).not.toHaveBeenCalled();
});
it("does not persist demo extensions",async()=>{
  state.context.demo=true;expect((await (await POST(request(),route)).json()).data.persisted).toBe(false);expect(state.update).not.toHaveBeenCalled();
});
