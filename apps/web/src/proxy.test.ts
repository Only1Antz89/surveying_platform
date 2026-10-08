import {afterEach,describe,it,expect,vi} from "vitest";
import {NextRequest,type NextFetchEvent} from "next/server";
vi.mock("@clerk/nextjs/server",()=>({clerkMiddleware:()=>vi.fn()}));
vi.mock("@/lib/website-form",()=>({embeddingOrigins:vi.fn()}));
import proxy from "./proxy";
afterEach(()=>vi.unstubAllEnvs());
describe("trusted workspace rewrite context",()=>{
 it("overwrites forged context on canonical URLs",async()=>{vi.stubEnv("CLERK_SECRET_KEY","");const response=await proxy(new NextRequest("https://app.test/app/practice/jobs",{headers:{"x-surveynt-workspace-mode":"administration"}}),{} as NextFetchEvent);expect(response.headers.get("x-middleware-request-x-surveynt-workspace-mode")).toBe("default");expect(response.headers.get("x-middleware-rewrite")).toBeNull();});
 it("does not expose unknown internal workspace choices",async()=>{vi.stubEnv("CLERK_SECRET_KEY","");const response=await proxy(new NextRequest("https://app.test/app/practice/workspace-instances/platform/jobs"),{} as NextFetchEvent);expect(response.status).toBe(404);});
 it("derives page and API modes only from the requested aliases",async()=>{vi.stubEnv("CLERK_SECRET_KEY","");for(const [path,canonical,mode] of [["/app/practice/surveyor/jobs","/app/practice/workspace-instances/surveyor/jobs","surveyor"],["/api/v1/workspaces/manager/team","/api/v1/team","manager"]]){const response=await proxy(new NextRequest(`https://app.test${path}`,{headers:{"x-surveynt-workspace-mode":"owner"}}),{} as NextFetchEvent);expect(response.headers.get("x-middleware-rewrite")).toBe(`https://app.test${canonical}`);expect(response.headers.get("x-middleware-request-x-surveynt-workspace-mode")).toBe(mode);expect(response.headers.get("cache-control")).toBe("private, no-store");}});
});
