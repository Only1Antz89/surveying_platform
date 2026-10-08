import { afterEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({worker:vi.fn()}));
vi.mock("@/lib/document-removal",()=>({processDocumentRemovalQueue:state.worker}));
import { GET } from "./route";
const request=(token="test-cron")=>new Request("https://surveynt.test/api/cron/documents",{headers:{authorization:`Bearer ${token}`}});
afterEach(()=>{vi.unstubAllEnvs();state.worker.mockReset();});
describe("scheduled reviewed document removal",()=>{
  it("rejects absent or incorrect authorization without running storage work",async()=>{
    vi.stubEnv("CRON_SECRET","");expect((await GET(request())).status).toBe(401);
    vi.stubEnv("CRON_SECRET","test-cron");expect((await GET(request("wrong"))).status).toBe(401);expect(state.worker).not.toHaveBeenCalled();
  });
  it("reports missing database configuration without claiming jobs",async()=>{
    vi.stubEnv("CRON_SECRET","test-cron");vi.stubEnv("DATABASE_ADMIN_URL","");expect((await GET(request())).status).toBe(503);expect(state.worker).not.toHaveBeenCalled();
  });
  it("runs the bounded worker and reports missing object storage",async()=>{
    vi.stubEnv("CRON_SECRET","test-cron");vi.stubEnv("DATABASE_ADMIN_URL","postgresql://fictional/test");
    state.worker.mockResolvedValue({configured:false,removed:0,review:0});expect((await GET(request())).status).toBe(503);
    state.worker.mockResolvedValue({configured:true,removed:2,review:1});const response=await GET(request());expect(response.status).toBe(200);expect((await response.json()).result.removed).toBe(2);expect(state.worker).toHaveBeenLastCalledWith(10);
  });
  it("reports failure without exposing connection or object details",async()=>{
    vi.stubEnv("CRON_SECRET","test-cron");vi.stubEnv("DATABASE_ADMIN_URL","postgresql://fictional/test");
    state.worker.mockRejectedValue(new Error("private-database-secret"));const response=await GET(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain("private-database-secret");
  });
});
