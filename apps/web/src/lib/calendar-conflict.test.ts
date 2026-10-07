import { describe,expect,it } from "vitest";
import { hasExternalCalendarConflict } from "./calendar-conflict";
const start=new Date("2026-10-07T09:00:00Z"),end=new Date("2026-10-07T10:00:00Z");
const event={id:"external",start,end,version:"remote-1",surveyntAppointmentId:"appointment",cancelled:false};
const appointment={startsAt:start,endsAt:end,version:1};
const link={externalVersion:"remote-1",lastSyncedAppointmentVersion:1};
describe("calendar revision conflict detection",()=>{
  it("does not flag a local reschedule against the unchanged provider revision",()=>{expect(hasExternalCalendarConflict(event,{...appointment,startsAt:new Date(start.getTime()+3600000),endsAt:new Date(end.getTime()+3600000),version:2},link)).toBe(false);});
  it("holds competing local and remote reschedules for review",()=>{expect(hasExternalCalendarConflict({...event,version:"remote-2"},{...appointment,startsAt:new Date(start.getTime()+3600000),version:2},link)).toBe(true);});
  it("detects external changes and cancellations even when times are absent",()=>{expect(hasExternalCalendarConflict({...event,start:new Date(start.getTime()+3600000)},appointment,link)).toBe(true);expect(hasExternalCalendarConflict({...event,cancelled:true,start:null,end:null},appointment,link)).toBe(true);});
  it("requires review if the provider revision cannot prove a local-only change",()=>{expect(hasExternalCalendarConflict({...event,version:null},{...appointment,startsAt:new Date(start.getTime()+3600000),version:2},link)).toBe(true);expect(hasExternalCalendarConflict(event,appointment,link)).toBe(false);});
});
