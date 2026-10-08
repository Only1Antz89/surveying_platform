import {describe,it,expect,vi,beforeEach} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({network:vi.fn()}));
vi.mock("./connection-network",()=>({connectionJson:mock.network}));
vi.mock("./firm-operations",()=>({listFirmOperations:vi.fn(),readPublicQuote:vi.fn()}));
import {conversationalAnswer} from "./surveyant-chat";
import type {platformConnections} from "@surveynt/db";
const connection={endpoint:"https://configured.example/v1",credentialEnv:null} as typeof platformConnections.$inferSelect;
const sources=[{id:"case:allowed",label:"Permitted case",href:"jobs/allowed",data:{reference:"CASE-A"}}];
beforeEach(()=>mock.network.mockReset());
describe("grounded Surveyant conversation adapter",()=>{
 it("rejects citation identifiers outside the supplied records",async()=>{mock.network.mockResolvedValue({choices:[{message:{content:JSON.stringify({answer:"Unsupported case",citationIds:["case:other-tenant"]})}}]});await expect(conversationalAnswer(connection,"approved","question",sources)).rejects.toThrow("grounded");});
 it("rejects answers without sources and malformed provider output",async()=>{for(const content of ['{"answer":"uncited","citationIds":[]}',"not JSON"]){mock.network.mockResolvedValue({choices:[{message:{content}}]});await expect(conversationalAnswer(connection,"approved","question",sources)).rejects.toThrow();}});
 it("returns only validated source links and sends bounded history as untrusted data",async()=>{mock.network.mockResolvedValue({choices:[{message:{content:JSON.stringify({answer:"CASE-A is available",citationIds:["case:allowed"]})}}]});const answer=await conversationalAnswer(connection,"approved","question",sources,[{role:"assistant",content:"Earlier context"}]);expect(answer.citations).toEqual([{id:"case:allowed",label:"Permitted case",href:"jobs/allowed"}]);expect(mock.network.mock.calls[0][2].body.model).toBe("approved");expect(JSON.parse(mock.network.mock.calls[0][2].body.messages[1].content).previousConversation).toHaveLength(1);});
});
