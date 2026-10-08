import { describe,expect,it } from "vitest";
import { availableSurveyor, withinWorkingHours } from "./booking-slots";
import { integrationReadiness } from "./capabilities";
import { localDayRange } from "./scheduling";
import { notificationResources } from "./notifications";
const settings={timezone:"Europe/London",workingDays:["monday","tuesday","wednesday","thursday","friday"],workingHours:{monday:{start:"09:00",end:"17:00"}},holidayDates:[],bookingHorizonDays:90};
describe("booking availability",()=>{
  it("does not offer a member’s explicitly unavailable day",()=>{
    const data={members:[{id:"member-a",role:"surveyor" as const}],profiles:[{userId:"member-a",timezone:"Europe/London",workingHours:{monday:{start:"09:00",end:"17:00",closed:true}}}],visits:[],blocks:[]};
    expect(availableSurveyor(new Date("2026-10-26T09:00:00Z"),new Date("2026-10-26T11:00:00Z"),{...settings,travelBufferMinutes:30},data,new Date("2026-10-01"))).toBeNull();
  });
  it("inherits firm hours without reinterpreting them in a member timezone",()=>{
    const data={members:[{id:"member-a",role:"surveyor" as const}],profiles:[{userId:"member-a",timezone:"America/New_York",workingHours:{}}],visits:[],blocks:[]};
    expect(availableSurveyor(new Date("2026-10-26T09:00:00Z"),new Date("2026-10-26T11:00:00Z"),{...settings,travelBufferMinutes:30},data,new Date("2026-10-01"))).toBe("member-a");
  });
  it("chooses another member when personal hours exclude a slot and cannot override firm closures",()=>{
    const data={members:[{id:"member-a",role:"surveyor" as const},{id:"member-b",role:"owner" as const}],profiles:[{userId:"member-a",timezone:"Europe/London",workingHours:{monday:{start:"13:00",end:"17:00"}}}],visits:[],blocks:[]};
    const start=new Date("2026-10-26T09:00:00Z"),end=new Date("2026-10-26T11:00:00Z"),now=new Date("2026-10-01");
    expect(availableSurveyor(start,end,{...settings,travelBufferMinutes:30},data,now)).toBe("member-b");
    expect(availableSurveyor(start,end,{...settings,travelBufferMinutes:30,holidayDates:["2026-10-26"]},data,now)).toBeNull();
  });
  it("uses 23-hour and 25-hour local day bounds",()=>{const spring=localDayRange("2026-03-29"),autumn=localDayRange("2026-10-25");expect(spring.end.getTime()-spring.start.getTime()).toBe(23*3600000);expect(autumn.end.getTime()-autumn.start.getTime()).toBe(25*3600000);});
  it("uses London wall time across the autumn DST boundary",()=>{
    const now=new Date("2026-10-01T00:00:00Z");
    expect(withinWorkingHours(new Date("2026-10-19T08:00:00Z"),new Date("2026-10-19T10:00:00Z"),settings,now)).toBe(true);
    expect(withinWorkingHours(new Date("2026-10-26T08:00:00Z"),new Date("2026-10-26T10:00:00Z"),settings,now)).toBe(false);
    expect(withinWorkingHours(new Date("2026-10-26T09:00:00Z"),new Date("2026-10-26T11:00:00Z"),settings,now)).toBe(true);
  });
  it("rejects weekends, closures and visits crossing office closing time",()=>{
    const now=new Date("2026-10-01T00:00:00Z");
    expect(withinWorkingHours(new Date("2026-10-24T09:00:00Z"),new Date("2026-10-24T11:00:00Z"),settings,now)).toBe(false);
    expect(withinWorkingHours(new Date("2026-10-26T16:00:00Z"),new Date("2026-10-26T18:00:00Z"),settings,now)).toBe(false);
    expect(withinWorkingHours(new Date("2026-10-26T09:00:00Z"),new Date("2026-10-26T11:00:00Z"),{...settings,holidayDates:["2026-10-26"]},now)).toBe(false);
  });
});
describe("notification preferences",()=>{
  it("filters disabled categories and role-restricted financial events",()=>{
    expect(notificationResources({"Assigned jobs":false,"Report reviews":false,"Appointment changes":false,"Payment updates":false},"owner")).toEqual([]);
    expect(notificationResources({},"surveyor")).not.toContain("client_payment");
    expect(notificationResources({},"owner")).toContain("client_payment");
  });
});
describe("readiness",()=>{
  it("shows demo adapters without relying on external credentials",()=>expect(integrationReadiness(true,{}).every(c=>c.state==="Demo")).toBe(true));
  it("does not advertise unconfigured providers as available",()=>expect(integrationReadiness(false,{}).every(c=>c.state==="Setup required")).toBe(true));
  it("never exposes credentials and retains payment approval",()=>{const states=integrationReadiness(false,{QUOTE_TOKEN_SECRET:"hidden",STRIPE_CLIENT_PAYMENTS_KEY:"secret"});expect(states.find(c=>c.key==="payments")?.state).toBe("Pending approval");expect(JSON.stringify(states)).not.toContain("hidden");expect(JSON.stringify(states)).not.toContain('"secret"');});
});
