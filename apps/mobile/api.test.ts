import { afterEach, expect, it, vi } from "vitest";
vi.mock("./offline-queue", () => ({PermanentError:class PermanentError extends Error {}}));
import { apiClient } from "./api";
afterEach(()=>vi.unstubAllGlobals());
it("sends the dedicated audience token, matching session and stable queue id together",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{id:"record"}}),{headers:{"content-type":"application/json"}}));
 vi.stubGlobal("fetch",fetcher);
 const getToken=vi.fn(async(options?:{template:string})=>options?.template==="surveynt-mobile"?"mobile-token":"session-token");
 const client=apiClient(getToken);
 await client.json("/api/mobile/jobs/job/costs",{kind:"time",minutes:30},"q_stable_retry");
 expect(getToken.mock.calls).toEqual([[{template:"surveynt-mobile"}],[]]);
 expect(fetcher.mock.calls[0][1].headers).toMatchObject({authorization:"Bearer mobile-token","x-surveynt-session-token":"session-token","x-surveynt-operation-id":"q_stable_retry"});
});
