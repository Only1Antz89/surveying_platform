import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({context:{role:"manager",organisationId:"firm-1",demo:true},denial:null as Response|null,read:vi.fn()}));
vi.mock("@/lib/access",()=>({apiContext:async()=>state.context}));
vi.mock("@/lib/workspace-api-guard",()=>({workspaceApiGuard:async()=>state.denial}));
vi.mock("@/lib/insights",()=>({practiceInsights:state.read}));
import {GET} from "./route";
beforeEach(()=>{vi.clearAllMocks();state.context.role="manager";state.context.demo=true;state.denial=null;});
const request=(query="")=>new Request("http://surveynt.test/api/v1/insights"+query);
it("exposes clearly identified fixture counts without consulting a live database",async()=>{
 const response=await GET(request("?from=2026-10-01&to=2026-10-11"));expect(response.status).toBe(200);
 const data=(await response.json()).data;expect(data.preview).toBe(true);expect(data.pipeline.length).toBeGreaterThan(0);expect(data.money).toEqual([]);expect(data.completion.days).toBeNull();expect(state.read).not.toHaveBeenCalled();
});
it("validates date ranges and serves a CSV from the same demo indicators",async()=>{
 expect((await GET(request("?from=2026-11-01&to=2026-10-01"))).status).toBe(400);
 expect((await GET(request("?from=2024-01-01&to=2026-10-01"))).status).toBe(400);
 const response=await GET(request("?from=2026-10-01&to=2026-10-11&format=csv"));expect(response.headers.get("content-type")).toContain("text/csv");expect(await response.text()).toContain("pipeline");
});
it("enforces workspace suspension and management permissions",async()=>{
 state.denial=new Response(null,{status:403});expect((await GET(request())).status).toBe(403);
 state.denial=null;state.context.role="surveyor";expect((await GET(request())).status).toBe(403);expect(state.read).not.toHaveBeenCalled();
});
