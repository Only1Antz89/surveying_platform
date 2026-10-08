import { afterEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({constructed:vi.fn()}));
vi.mock("@neondatabase/serverless",()=>({Pool:class {
  ending=false;ended=false;
  async end(){this.ending=true;this.ended=true;}
  constructor(options:unknown){state.constructed(options);}
  on(){return this;}
}}));
vi.mock("drizzle-orm/neon-serverless",()=>({drizzle:({client}:{client:unknown})=>({$client:client})}));
import { createDatabase } from "./index";
afterEach(()=>vi.unstubAllEnvs());
describe("database connection reuse",()=>{
  it("reuses a single pool for repeated requests to the same database",()=>{
    const before=state.constructed.mock.calls.length;
    const first=createDatabase("postgresql://app@localhost/reuse");
    for(let index=0;index<100;index++)expect(createDatabase("postgresql://app@localhost/reuse")).toBe(first);
    expect(state.constructed.mock.calls.length-before).toBe(1);
  });
  it("keeps role credentials and databases isolated",()=>{
    const app=createDatabase("postgresql://app@localhost/roles");
    expect(createDatabase("postgresql://admin@localhost/roles")).not.toBe(app);
    expect(createDatabase("postgresql://app@localhost/another")).not.toBe(app);
  });
  it("resolves the configured application URL and fails when no URL exists",()=>{
    vi.stubEnv("DATABASE_APP_URL","postgresql://app@localhost/configured");
    expect(createDatabase()).toBe(createDatabase("postgresql://app@localhost/configured"));
    vi.stubEnv("DATABASE_APP_URL","");vi.stubEnv("DATABASE_URL","");expect(()=>createDatabase()).toThrow("required");
  });
  it("does not reuse explicitly ended pools",async()=>{
    const url="postgresql://app@localhost/ended",first=createDatabase(url);
    await first.$client.end();expect(createDatabase(url)).not.toBe(first);
  });
  it("provides separate pools to callers that own their closure",()=>{
    const url="postgresql://app@localhost/isolated",shared=createDatabase(url);
    const isolated=createDatabase(url,{reuse:false});expect(isolated).not.toBe(shared);
    expect(createDatabase(url,{reuse:false})).not.toBe(isolated);expect(createDatabase(url)).toBe(shared);
  });

});
