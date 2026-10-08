import { describe,expect,it } from "vitest";
import { professionalDetailsSchema } from "./professional-details";
import { newDeviceEvents,safeNotificationPath } from "./device-notifications";
import { notificationResources } from "./notifications";
describe("personal account settings",()=>{
  it("validates self-declared drone references without certification assumptions",()=>{
    expect(professionalDetailsSchema.parse({droneFlyerId:"  reference  "}).droneFlyerId).toBe("reference");
    expect(professionalDetailsSchema.safeParse({droneExpiry:"2026-02-30"}).success).toBe(false);
    expect(professionalDetailsSchema.safeParse({droneOperatorId:"x".repeat(101)}).success).toBe(false);
  });
  it("deduplicates seen operational events",()=>{
    expect(newDeviceEvents([{id:"a",label:"job",href:"/",detail:""},{id:"b",label:"job",href:"/",detail:""}],["a"]).map(row=>row.id)).toEqual(["b"]);
  });
  it("never opens external notification links",()=>{
    for(const href of ["https://example.org","//example.org","/app/x/../../platform","/app/x/jobs/../../platform","/app/x/jobs/%2e%2e/other","/app/x/jobs\\evil","javascript:alert(1)"])expect(safeNotificationPath(href)).toBe("/");
    expect(safeNotificationPath("/app/clifton-surveyors/jobs/123")).toBe("/app/clifton-surveyors/jobs/123");
  });
  it("restricts finance alerts and respects opt-outs",()=>{
    expect(notificationResources({},"finance")).toEqual(["invoice","client_payment","settlement_batch"]);
    expect(notificationResources({"Payment updates":false},"finance")).toEqual([]);
    expect(notificationResources({},"surveyor")).not.toContain("invoice");
  });
});
