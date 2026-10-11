import {describe,it,expect} from "vitest";
import {resolveWorkspace} from "./workspace-mode";
import {canUseSurvaiPage,canUsePlatformSurvaiPage,survaiPageFromPath,survaiContextCopy,survaiContextError} from "./survai-context";
import {survaiPageContextInput} from "./survai-context-schema";
const id="00000000-0000-0000-0000-000000000001";
describe("SurvAI page and access context",()=>{
 it.each([
  ["/app/firm/surveyor/calendar",null,"calendar"],
  ["/app/firm/manager/calendar","availability","availability"],
  ["/app/firm/manager/customers","quotes","quotes"],
  ["/app/firm/customers","enquiries","enquiries"],
  [`/app/firm/surveyor/jobs/${id}/survey`,null,"survey"],
  ["/app/firm/workspace-instances/surveyor/routes",null,"routes"],
  ["/app/firm/settings/billing",null,"billing"],
 ])("resolves %s without sending raw route or query text",(path,view,page)=>{
  expect(survaiPageFromPath(path,"firm",view).page).toBe(page);
 });
 it("binds case, property and customer pages to their selected record",()=>{
  expect(survaiPageFromPath(`/app/firm/surveyor/jobs/${id}`,"firm")).toEqual({page:"job",resourceId:id});
  expect(survaiPageFromPath(`/app/firm/properties/${id}`,"firm")).toEqual({page:"property",resourceId:id});
  expect(survaiPageFromPath(`/app/firm/customers/${id}`,"firm")).toEqual({page:"customer",resourceId:id});
 });
 it("keeps an owner in Surveyor mode within assigned work",()=>{
  const role=resolveWorkspace("owner","surveyor")!.effectiveRole;
  expect(canUseSurvaiPage("finance",role)).toBe(false);
  const calendar=survaiContextCopy({page:"calendar"},{mode:"firm",role});
  expect(calendar.actions[0].label).toBe("Review my inspections");
  expect(calendar.actions.every(a=>a.question.includes("only my assigned cases"))).toBe(true);
  expect(survaiContextCopy({page:"finance"},{mode:"firm",role}).actions).toEqual([]);
 });
 it("offers different overview actions for surveyor and manager workspaces",()=>{
  const personal=survaiContextCopy({page:"overview"},{mode:"firm",role:"surveyor"});
  const manager=survaiContextCopy({page:"overview"},{mode:"firm",role:"manager"});
  expect(personal.actions[0].label).toBe("Review my assigned jobs");expect(manager.actions[0].label).toBe("Review team workload");
 });
 it("changes requests between Calendar, case preparation and Finance",()=>{
  const options={mode:"firm" as const,role:"manager" as const};
  expect(survaiContextCopy({page:"calendar"},options).actions[0].question).not.toEqual(survaiContextCopy({page:"jobs"},options).actions[0].question);
  expect(survaiContextCopy({page:"finance"},options).actions[0].label).toBe("Summarise outstanding balances");
 });
 it("excludes administration billing and configuration from Manager access",()=>{
  expect(canUseSurvaiPage("billing","manager")).toBe(false);
  expect(canUseSurvaiPage("services","manager")).toBe(false);
  expect(canUseSurvaiPage("billing","administrator")).toBe(false);
  expect(canUseSurvaiPage("billing","owner")).toBe(true);
  expect(canUseSurvaiPage("overview","read_only")).toBe(false);
  expect(canUseSurvaiPage("finance","finance")).toBe(false);
 });
 it("rejects forged finance or platform contexts for a surveyor",()=>{
  expect(survaiContextError({page:"finance"},{mode:"firm",role:"surveyor",demo:true})?.status).toBe(403);
  expect(survaiContextError({page:"platform-practices"},{mode:"firm",role:"owner"})?.status).toBe(403);
 });
 it("rejects a selected-case mismatch and missing selected record",()=>{
  expect(survaiContextError({page:"job",resourceId:id},{mode:"firm",role:"surveyor",jobId:"00000000-0000-0000-0000-000000000002"})?.status).toBe(422);
  expect(survaiContextError({page:"property"},{mode:"firm",role:"manager"})?.status).toBe(422);
 });
 it("requires authorised support context and restricts platform billing requests",()=>{
  expect(canUsePlatformSurvaiPage("platform-billing","support")).toBe(false);
  expect(canUsePlatformSurvaiPage("platform-billing","billing")).toBe(true);
  expect(survaiContextError({page:"support-session"},{mode:"platform",platformRole:"super_admin"})?.status).toBe(403);
  expect(survaiContextError({page:"support-session"},{mode:"support"})).toBeNull();
  expect(survaiContextError({page:"platform-practices"},{mode:"support"})?.status).toBe(403);
 });
 it("secure client cases cannot request practice or platform contexts",()=>{
  expect(survaiContextError({page:"client-case"},{mode:"case"})).toBeNull();
  expect(survaiContextError({page:"finance"},{mode:"case"})?.status).toBe(403);
 });
 it("rejects arbitrary URLs, role claims and invalid record IDs",()=>{
  expect(survaiPageContextInput.safeParse({page:"https://example.com"}).success).toBe(false);
  expect(survaiPageContextInput.safeParse({page:"calendar",role:"owner"}).success).toBe(false);
  expect(survaiPageContextInput.safeParse({page:"property",resourceId:"other-tenant"}).success).toBe(false);
  expect(survaiPageContextInput.safeParse({page:"finance",resourceId:id}).success).toBe(false);
 });
});
