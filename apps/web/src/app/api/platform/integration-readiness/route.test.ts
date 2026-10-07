import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({context:vi.fn()}));
vi.mock("@/lib/access",()=>({platformApiContext:mocks.context}));
import { GET } from "./route";
beforeEach(()=>vi.clearAllMocks());
it("denies unsigned callers",async()=>{mocks.context.mockResolvedValue(null);expect((await GET()).status).toBe(401);});
it("denies non-administrator platform staff",async()=>{for(const role of ["support","compliance","billing"]){mocks.context.mockResolvedValue({role,demo:true});expect((await GET()).status).toBe(403);}});
it("returns only public readiness for a Surveynt administrator",async()=>{mocks.context.mockResolvedValue({role:"super_admin",demo:true});const response=await GET();expect(response.status).toBe(200);const payload=await response.json();expect(payload.data.some((row:{key:string})=>row.key==="hmlr")).toBe(true);expect(payload.data.every((row:Record<string,unknown>)=>!("credentials" in row)&&!("secret" in row))).toBe(true);});

it("labels isolated platform preview capabilities Demo",async()=>{mocks.context.mockResolvedValue({role:"super_admin",demo:true});const payload=await (await GET()).json();expect(payload.meta.demo).toBe(true);expect(payload.data.every((row:{state:string})=>row.state==="Demo")).toBe(true);});
it("retains real readiness classification for live administrators",async()=>{mocks.context.mockResolvedValue({role:"super_admin",demo:false});const payload=await (await GET()).json();expect(payload.meta.demo).toBe(false);expect(payload.data.every((row:{state:string})=>row.state!=="Demo")).toBe(true);});
