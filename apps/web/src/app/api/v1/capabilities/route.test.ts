import {beforeEach,describe,expect,it,vi} from "vitest";
const context=vi.hoisted(()=>({value:{organisationId:"preview",demo:true,role:"owner",record:false,approve:false} as {organisationId:string;demo:boolean;role:string;record:boolean;approve:boolean}|null}));
const registry=vi.hoisted(()=>vi.fn());
const database=vi.hoisted(()=>vi.fn());
vi.mock("server-only",()=>({}));
vi.mock("@/lib/access",()=>({apiContext:async()=>context.value}));
vi.mock("@/lib/stakeholder-demo",()=>({isDemoOrganisation:registry}));
vi.mock("@/lib/professional-access",()=>({canRecord:(value:{record:boolean})=>value.record,canApprove:(value:{approve:boolean})=>value.approve}));
vi.mock("@surveynt/db",async original=>({...await original<object>(),createDatabase:database}));
import {GET} from "./route";
beforeEach(()=>{context.value={organisationId:"preview",demo:true,role:"owner",record:false,approve:false};registry.mockReset();registry.mockResolvedValue(false);database.mockReset();database.mockImplementation(()=>{throw new Error("Live database must not be used by a demo capability request");});});
const request=()=>new Request("https://surveynt.test/api/v1/capabilities");
describe("demo capability isolation",()=>{
 it("requires authentication before registry or database access",async()=>{context.value=null;expect((await GET(request())).status).toBe(401);expect(registry).not.toHaveBeenCalled();expect(database).not.toHaveBeenCalled();});
 it("labels local preview integrations as Demo without live registry or database reads",async()=>{const response=await GET(request());expect(response.status).toBe(200);const {data}=await response.json();expect(data.filter((row:{key:string})=>!["record_survey","approve_reports"].includes(row.key)).every((row:{state:string})=>row.state==="Demo")).toBe(true);expect(data.filter((row:{key:string})=>["record_survey","approve_reports"].includes(row.key)).every((row:{state:string})=>row.state==="Unavailable")).toBe(true);expect(data.every((row:{connectHref?:string})=>!row.connectHref)).toBe(true);expect(registry).not.toHaveBeenCalled();expect(database).not.toHaveBeenCalled();});
 it("classifies persistent demo practices without loading live integration settings",async()=>{context.value!.demo=false;registry.mockResolvedValue(true);const {data}=await (await GET(request())).json();expect(data.find((row:{key:string})=>row.key==="google").state).toBe("Demo");expect(registry).toHaveBeenCalledWith("preview");expect(database).not.toHaveBeenCalled();});
 it("keeps role visibility and professional grants independent of demo classification",async()=>{context.value!.role="finance";const {data}=await (await GET(request())).json();expect(data.map((row:{key:string})=>row.key)).toEqual(["google","microsoft"]);expect(data.every((row:{state:string;action:string})=>row.state==="Demo"&&row.action==="Contact your practice administrator")).toBe(true);context.value!.role="owner";context.value!.record=true;const approved=await (await GET(request())).json();expect(approved.data.find((row:{key:string})=>row.key==="record_survey").state).toBe("Available");expect(approved.data.find((row:{key:string})=>row.key==="approve_reports").state).toBe("Unavailable");expect(database).not.toHaveBeenCalled();});
});
