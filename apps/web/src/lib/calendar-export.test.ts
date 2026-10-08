import { describe,expect,it,vi } from "vitest";
import { createExternalEvent } from "./calendar-export";
const appointment={id:"fictional-appointment",startsAt:new Date("2026-10-07T09:00:00Z"),endsAt:new Date("2026-10-07T10:00:00Z")};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
describe("retryable calendar exports",()=>{
  it("uses a stable connection-scoped Google identity",async()=>{
    const fetcher=vi.fn().mockImplementation(async(_url:string,options:RequestInit)=>json({id:JSON.parse(options.body as string).id}));
    await createExternalEvent("google","token",appointment,"connection",fetcher);await createExternalEvent("google","token",appointment,"connection",fetcher);await createExternalEvent("google","token",appointment,"other-connection",fetcher);
    const bodies=fetcher.mock.calls.map(call=>JSON.parse(call[1].body as string));expect(bodies[0].id).toMatch(/^[0-9a-v]{64}$/);expect(bodies[1].id).toBe(bodies[0].id);expect(bodies[2].id).not.toBe(bodies[0].id);
  });
  it("recovers a matching previously created Google event after a duplicate response",async()=>{
    const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>options.method==="POST"?json({},409):json({id:url.split("/").at(-1),etag:"existing",extendedProperties:{private:{surveyntAppointmentId:appointment.id}},start:{dateTime:appointment.startsAt.toISOString()},end:{dateTime:appointment.endsAt.toISOString()}}));
    expect(await createExternalEvent("google","token",appointment,"connection",fetcher)).toMatchObject({version:"existing"});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refuses to adopt cancelled, unrelated or changed prior events",async()=>{
    for(const variant of [{status:"cancelled"},{extendedProperties:{private:{surveyntAppointmentId:"other"}}},{start:{dateTime:"2026-10-07T11:00:00Z"}}]){
      const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>options.method==="POST"?json({},409):json({id:url.split("/").at(-1),extendedProperties:{private:{surveyntAppointmentId:appointment.id}},start:{dateTime:appointment.startsAt.toISOString()},end:{dateTime:appointment.endsAt.toISOString()},...variant}));await expect(createExternalEvent("google","token",appointment,"connection",fetcher)).rejects.toThrow("Review is required");
    }
  });
  it("keeps Microsoft's transactionId stable across retries and bounds provider requests",async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>json({id:"microsoft-event",changeKey:"version"}));await createExternalEvent("microsoft","token",appointment,"connection",fetcher);await createExternalEvent("microsoft","token",appointment,"connection",fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).transactionId).toBe(JSON.parse(fetcher.mock.calls[1][1].body as string).transactionId);expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:"error",signal:expect.any(AbortSignal)});
  });
});
