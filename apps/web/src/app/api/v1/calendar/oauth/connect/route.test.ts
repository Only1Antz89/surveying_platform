import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({context:vi.fn(),authorize:vi.fn(),demo:vi.fn()}));
vi.mock("@/lib/access",()=>({apiContext:mocks.context,canWriteWorkspace:(context:{accessLevel:string})=>context.accessLevel==="full"}));
vi.mock("@/lib/calendar-oauth",()=>({createCalendarAuthorization:mocks.authorize}));
vi.mock("@/lib/stakeholder-demo",()=>({isDemoOrganisation:mocks.demo}));
vi.mock("@/lib/workspace-api-guard",()=>({workspaceApiGuard:vi.fn().mockResolvedValue(null)}));
import { GET } from "./route";
beforeEach(()=>{vi.clearAllMocks();mocks.demo.mockResolvedValue(false);mocks.authorize.mockReturnValue("https://accounts.example.org/authorize");});
it("allows every active membership to connect only its own calendar",async()=>{for(const role of ["owner","administrator","manager","surveyor","finance","coordinator","read_only"]){mocks.context.mockResolvedValue({internalUserId:"own-user",organisationId:"own-org",role,accessLevel:"full"});expect((await GET(new Request("http://localhost/api/v1/calendar/oauth/connect?provider=google"))).status).toBe(302);expect(mocks.authorize).toHaveBeenLastCalledWith("google",{userId:"own-user",organisationId:"own-org"},"http://localhost");}});
it("blocks live OAuth in a demo organisation",async()=>{mocks.context.mockResolvedValue({internalUserId:"own-user",organisationId:"demo-org",role:"owner",accessLevel:"full"});mocks.demo.mockResolvedValue(true);expect((await GET(new Request("http://localhost/api/v1/calendar/oauth/connect?provider=microsoft"))).status).toBe(409);expect(mocks.authorize).not.toHaveBeenCalled();});

it("stores the selected workspace in encrypted OAuth state rather than a cookie",async()=>{mocks.context.mockResolvedValue({internalUserId:"own-user",organisationId:"own-org",role:"surveyor",actorRole:"owner",workspaceMode:"surveyor",accessLevel:"full"});await GET(new Request("http://localhost/api/v1/workspaces/surveyor/calendar/oauth/connect?provider=google"));expect(mocks.authorize).toHaveBeenLastCalledWith("google",{userId:"own-user",organisationId:"own-org",workspaceMode:"surveyor"},"http://localhost");});
