import {beforeEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({context:{role:"surveyor",organisationId:"org",internalUserId:"user",accessLevel:"full",demo:true},send:vi.fn()}));
vi.mock("@/lib/access",()=>({apiContext:async()=>mocks.context}));
vi.mock("@/lib/workspace-api-guard",()=>({workspaceApiGuard:async()=>null}));
vi.mock("@/lib/workspace-scope",()=>({canAccessAssignedResource:async()=>true}));
vi.mock("@/lib/surveyant-chat",async()=>{const{z}=await import("zod");const{survaiPageContextInput}=await import("./survai-context-schema");return {chatInput:z.object({message:z.string(),jobId:z.uuid().optional(),pageContext:survaiPageContextInput.optional()}),chatHistory:async()=>({messages:[]}),sendChat:mocks.send};});
import {GET,POST} from "../app/api/v1/surveyant/route";
beforeEach(()=>{mocks.context.role="surveyor";mocks.send.mockReset();});
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
});
