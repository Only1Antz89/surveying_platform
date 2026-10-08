import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({context:vi.fn(),demo:vi.fn(),where:vi.fn(),values:vi.fn(),lock:vi.fn(),rows:[] as Record<string,unknown>[]}));
vi.mock("@/lib/access",()=>({apiContext:mocks.context,canWriteWorkspace:(context:{accessLevel:string})=>context.accessLevel==="full"}));
vi.mock("@/lib/stakeholder-demo",()=>({isDemoOrganisation:mocks.demo}));
vi.mock("drizzle-orm",()=>({sql:(strings:TemplateStringsArray,...values:unknown[])=>({strings,values}),and:(...conditions:unknown[])=>conditions,eq:(column:unknown,value:unknown)=>({column,value})}));
vi.mock("@surveynt/db",()=>({
  calendarConnections:{id:"id",organisationId:"organisation",userId:"user",provider:"provider",status:"status",lastSyncedAt:"lastSyncedAt"},
  auditEvents:{},backgroundJobs:{},createDatabase:()=>({}),
  withTenant:async(_db:unknown,_org:unknown,run:(tx:unknown)=>unknown)=>run({
    execute:mocks.lock,
    select:()=>({from:()=>({where:(filter:unknown)=>{mocks.where(filter);return {for:async()=>mocks.rows,then:(resolve:(value:unknown)=>unknown)=>resolve(mocks.rows)};}})}),
    insert:()=>({values:(value:unknown)=>{mocks.values(value);return {onConflictDoNothing:async()=>undefined};}}),
  }),
}));
import { GET,POST } from "./route";
const id="00000000-0000-4000-8000-000000000001";
const request=()=>new Request("http://localhost/api/v1/me/calendar-connections",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,action:"sync",userId:"attacker",organisationId:"attacker"})});
beforeEach(()=>{vi.clearAllMocks();mocks.lock.mockResolvedValue({rows:[{acquired:true}]});mocks.demo.mockResolvedValue(false);mocks.rows=[];mocks.context.mockResolvedValue({internalUserId:"own-user",organisationId:"own-org",accessLevel:"full"});});
it("scopes connection reads to the authenticated user and tenant",async()=>{expect((await GET(new Request("http://localhost/api/v1/me/calendar-connections"))).status).toBe(200);expect(mocks.where).toHaveBeenCalledWith([{column:"organisation",value:"own-org"},{column:"user",value:"own-user"}]);});
it("returns 404 for a guessed connection and queues nothing",async()=>{expect((await POST(request())).status).toBe(404);expect(mocks.values).not.toHaveBeenCalled();});
it("ignores submitted ownership and rechecks the selected connection",async()=>{mocks.rows=[{id,status:"active",provider:"google"}];expect((await POST(request())).status).toBe(200);expect(mocks.where).toHaveBeenCalledWith([{column:"id",value:id},{column:"organisation",value:"own-org"},{column:"user",value:"own-user"}]);expect(mocks.values.mock.calls[0][0]).toMatchObject({organisationId:"own-org",queue:"calendar",payload:{connectionId:id}});});
it("prevents demo or read-only workspaces from changing live calendars",async()=>{mocks.demo.mockResolvedValue(true);expect((await POST(request())).status).toBe(409);mocks.context.mockResolvedValue({internalUserId:"own-user",organisationId:"own-org",accessLevel:"read_only"});expect((await POST(request())).status).toBe(403);expect(mocks.where).not.toHaveBeenCalled();});

it("holds lifecycle actions while reconciliation owns the connection lock",async()=>{mocks.rows=[{id,status:"active",provider:"google"}];mocks.lock.mockResolvedValue({rows:[{acquired:false}]});expect((await POST(request())).status).toBe(409);expect(mocks.values).not.toHaveBeenCalled();});
