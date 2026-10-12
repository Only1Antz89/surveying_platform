import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({context:{role:"surveyor",organisationId:"org",internalUserId:"user",accessLevel:"full",demo:true},send:vi.fn(),provider:vi.fn()}));
vi.mock("./demo-store",()=>({demoStore:{snapshot:async()=>({tenants:[{id:"org",name:"Demo practice",status:"active"}],clients:[]})}}));
vi.mock("@/lib/access",()=>({apiContext:async()=>mocks.context}));
vi.mock("@/lib/workspace-api-guard",()=>({workspaceApiGuard:async()=>null}));
vi.mock("@/lib/workspace-scope",()=>({canAccessAssignedResource:async()=>true}));
vi.mock("@/lib/surveyant-chat",async()=>{const{z}=await import("zod");const{survaiPageContextInput}=await import("./survai-context-schema");return {chatInput:z.object({message:z.string(),jobId:z.uuid().optional(),pageContext:survaiPageContextInput.optional()}),chatHistory:async()=>({messages:[]}),sendChat:mocks.send,conversationalAnswer:mocks.provider};});
import {GET,POST} from "../app/api/v1/surveyant/route";
beforeEach(()=>{mocks.context.role="surveyor";mocks.context.demo=true;mocks.send.mockReset();mocks.provider.mockReset();vi.stubEnv("SURVEYNT_DEMO_AI_ENABLED","false");vi.stubEnv("SURVEYNT_CONNECTION_SECRET_GEMINI","");vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","");vi.stubEnv("CLERK_SECRET_KEY","");});
afterEach(()=>vi.unstubAllEnvs());
describe("contextual SurvAI API boundary",()=>{
 it("rejects a finance context before the demo or provider branch",async()=>{
  const response=await POST(new Request("https://surveynt.test/api/v1/surveyant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"Financial totals",pageContext:{page:"finance"}})}));
  expect(response.status).toBe(403);expect(mocks.send).not.toHaveBeenCalled();
 });
 it("allows assigned-work Calendar context through to the existing demo limitation",async()=>{
  const response=await POST(new Request("https://surveynt.test/api/v1/surveyant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"Review my inspections",pageContext:{page:"calendar"}})}));
  expect(response.status).toBe(503);expect(mocks.send).not.toHaveBeenCalled();
 });
 it("rejects disallowed history-page contexts too",async()=>{
  const response=await GET(new Request("https://surveynt.test/api/v1/surveyant?page=finance"));expect(response.status).toBe(403);
 });
 it("rejects role injection in context metadata",async()=>{
  const response=await POST(new Request("https://surveynt.test/api/v1/surveyant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"Review",pageContext:{page:"calendar",role:"owner"}})}));expect(response.status).toBe(422);
 });
 it("returns a cited Gemini demo answer when explicitly configured",async()=>{
  mocks.context.role="manager";vi.stubEnv("SURVEYNT_DEMO_AI_ENABLED","true");vi.stubEnv("SURVEYNT_CONNECTION_SECRET_GEMINI","test-only");
  mocks.provider.mockResolvedValue({content:"No invoices were supplied.",citations:[{id:"demo:finance",label:"Empty ledger",href:"finance"}]});
  const response=await POST(new Request("https://surveynt.test/api/v1/surveyant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"Read the empty ledger",pageContext:{page:"finance"}})}));
  expect(response.status).toBe(200);expect((await response.json()).data.message).toMatchObject({demo:true,model:"gemini-3.1-flash-lite"});expect(mocks.send).not.toHaveBeenCalled();expect(mocks.provider).toHaveBeenCalledOnce();
 });
 it("retains the production governed path when the demo flag is enabled",async()=>{
  mocks.context.role="manager";mocks.context.demo=false;vi.stubEnv("SURVEYNT_DEMO_AI_ENABLED","true");mocks.send.mockResolvedValue({message:{role:"assistant",content:"Governed answer"}});
  const response=await POST(new Request("https://surveynt.test/api/v1/surveyant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"Review records",pageContext:{page:"finance"}})}));
  expect(response.status).toBe(200);expect(mocks.send).toHaveBeenCalledOnce();expect(mocks.provider).not.toHaveBeenCalled();
 });
});
