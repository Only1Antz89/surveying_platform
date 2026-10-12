import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({role:"manager",mode:"manager"}));
vi.mock("./access",()=>({requireFirmAccess:async()=>({userRole:state.role,workspaceMode:state.mode})}));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("not-found");}}));
import {requireWorkspacePageAccess} from "./workspace-page-access";
beforeEach(()=>{state.role="manager";state.mode="manager";});
it("allows managers to open CRM, finance and insights",async()=>{
 for(const area of ["customers","clients","finance","performance"]) await expect(requireWorkspacePageAccess("firm",area)).resolves.toMatchObject({userRole:"manager"});
});
it("keeps administration configuration outside the manager workspace",async()=>{
 for(const area of ["services","locations","routes"]) await expect(requireWorkspacePageAccess("firm",area)).rejects.toThrow("not-found");
});
it("keeps management insights private from surveyors",async()=>{
 state.role="surveyor";state.mode="surveyor";await expect(requireWorkspacePageAccess("firm","performance")).rejects.toThrow("not-found");
});
