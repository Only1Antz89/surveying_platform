import { describe,expect,it,vi } from "vitest";
import { readReviewedExternalEvent,replaceCancelledExternalEvent,restoreExternalTime } from "./calendar-provider-review";
const visit={id:"visit",startsAt:new Date("2026-10-07T09:00:00Z"),endsAt:new Date("2026-10-07T10:00:00Z")};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const body=(provider:string,matching=false,version="reviewed")=>({id:"linked",...(provider==="google"?{etag:version,extendedProperties:{private:{surveyntAppointmentId:visit.id}}}:{changeKey:version,"@odata.etag":'W/"conditional"',categories:[`surveynt:${visit.id}`]}),start:{dateTime:matching?visit.startsAt.toISOString():"2026-10-07T11:00:00Z"},end:{dateTime:matching?visit.endsAt.toISOString():"2026-10-07T12:00:00Z"}});
describe("reviewed provider time restoration",()=>{
  it("conditionally patches only times and verifies them for both providers",async()=>{
    for(const provider of ["google","microsoft"] as const){const fetcher=vi.fn().mockResolvedValueOnce(json(body(provider))).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(body(provider,true,"restored")));expect(await restoreExternalTime(provider,"token",visit,"linked","reviewed",fetcher)).toEqual({version:"restored",changed:true});expect(fetcher.mock.calls[1][1].headers["if-match"]).toBe(provider==="google"?"reviewed":'W/"conditional"');expect(Object.keys(JSON.parse(fetcher.mock.calls[1][1].body))).toEqual(["start","end"]);}
  });
  it("rejects a newer provider revision without sending an update",async()=>{const fetcher=vi.fn().mockResolvedValue(json(body("google",false,"newer")));await expect(restoreExternalTime("google","token",visit,"linked","reviewed",fetcher)).rejects.toThrow("changed after review");expect(fetcher).toHaveBeenCalledTimes(1);});
  it("recovers already restored times without a second PATCH",async()=>{const fetcher=vi.fn().mockResolvedValue(json(body("google",true,"restored")));expect(await restoreExternalTime("google","token",visit,"linked","reviewed",fetcher)).toEqual({version:"restored",changed:false});expect(fetcher).toHaveBeenCalledTimes(1);});
  it("holds provider races and unconfirmed updates for another review",async()=>{
    const race=vi.fn().mockResolvedValueOnce(json(body("google"))).mockResolvedValueOnce(json({},412));await expect(restoreExternalTime("google","token",visit,"linked","reviewed",race)).rejects.toThrow("changed during review");
    const mismatch=vi.fn().mockResolvedValueOnce(json(body("google"))).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(body("google",false,"restored")));await expect(restoreExternalTime("google","token",visit,"linked","reviewed",mismatch)).rejects.toThrow("could not be confirmed");
  });
  it("requires identity and a conditional revision and refuses cancelled events",async()=>{
    for(const remote of [{...body("google"),extendedProperties:{private:{surveyntAppointmentId:"other"}}},{...body("google"),status:"cancelled"},{...body("microsoft"),"@odata.etag":undefined}]){const provider="changeKey" in remote?"microsoft":"google";const fetcher=vi.fn().mockResolvedValue(json(remote));await expect(restoreExternalTime(provider,"token",visit,"linked","reviewed",fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);}
  });
});

describe("reviewed cancellation replacement",()=>{
  it("verifies cancellation, reuses the replacement identity and verifies the new event",async()=>{
    for(const provider of ["google","microsoft"] as const){
      let created:Record<string,unknown>|null=null,count=0;
      const fetcher=vi.fn().mockImplementation(async(url:string,options:RequestInit)=>{
        if(options.method==="POST"){
          const payload=JSON.parse(options.body as string);
          if(created)return provider==="google"?json({},409):json(created);
          count++;created={...payload,id:payload.id??"replacement",etag:provider==="google"?"new":undefined,changeKey:provider==="microsoft"?"new":undefined};return json(created);
        }
        if(url.endsWith("/linked"))return json({id:"linked",...(provider==="google"?{status:"cancelled",etag:"reviewed"}:{isCancelled:true,changeKey:"reviewed"})});
        return json(created);
      });
      const first=await replaceCancelledExternalEvent(provider,"token",visit,"linked","reviewed","connection","conflict",fetcher);
      const retry=await replaceCancelledExternalEvent(provider,"token",visit,"linked","reviewed","connection","conflict",fetcher);
      expect(first.id).toBe(retry.id);expect(first.version).toBe("new");expect(count).toBe(1);
    }
  });
  it("does not create a replacement if cancellation evidence is stale or unavailable",async()=>{
    for(const response of [json(body("google")),json({id:"linked",status:"cancelled",etag:"newer"}),json({},503)]){
      const fetcher=vi.fn().mockResolvedValue(response);await expect(replaceCancelledExternalEvent("google","token",visit,"linked","reviewed","connection","conflict",fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

describe("reviewed external decisions",()=>{
  const reviewed={cancelled:false,start:"2026-10-07T11:00:00Z",end:"2026-10-07T12:00:00Z"};
  it("reads the exact reviewed time for both providers without an outgoing write",async()=>{
    for(const provider of ["google","microsoft"] as const){
      const fetcher=vi.fn().mockResolvedValue(json(body(provider)));
      expect(await readReviewedExternalEvent(provider,"token",visit.id,"linked","reviewed",reviewed,fetcher)).toMatchObject({id:"linked",version:"reviewed",cancelled:false,start:new Date(reviewed.start),end:new Date(reviewed.end)});
      expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].method).toBeUndefined();
    }
  });
  it("rejects changed identity, ownership, version, time and cancellation",async()=>{
    for(const remote of [{...body("google"),id:"other"},{...body("google"),etag:"newer"},{...body("google"),extendedProperties:{}},{...body("google"),start:{dateTime:"2026-10-07T10:00:00Z"}},{...body("google"),status:"cancelled"}]){
      const fetcher=vi.fn().mockResolvedValue(json(remote));await expect(readReviewedExternalEvent("google","token",visit.id,"linked","reviewed",reviewed,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("requires a valid timed interval and provider revision",async()=>{
    for(const remote of [{...body("google"),etag:undefined},{...body("google"),start:{date:"2026-10-07"}},{...body("google"),end:{dateTime:"2026-10-07T10:00:00Z"}}])await expect(readReviewedExternalEvent("google","token",visit.id,"linked","reviewed",reviewed,vi.fn().mockResolvedValue(json(remote)))).rejects.toThrow();
  });
  it("confirms a reviewed cancellation and holds changed cancellation revisions",async()=>{
    const cancelled={cancelled:true,start:null,end:null};
    expect(await readReviewedExternalEvent("google","token",visit.id,"linked","reviewed",cancelled,vi.fn().mockResolvedValue(json({id:"linked",status:"cancelled",etag:"reviewed"})))).toMatchObject({cancelled:true,start:null,end:null});
    await expect(readReviewedExternalEvent("google","token",visit.id,"linked","reviewed",cancelled,vi.fn().mockResolvedValue(json({id:"linked",status:"cancelled",etag:"newer"})))).rejects.toThrow();
  });
  it("accepts absence only for a reviewed cancellation without a revision",async()=>{
    const fetcher=vi.fn().mockResolvedValue(json({},404));
    expect(await readReviewedExternalEvent("microsoft","token",visit.id,"linked",null,{cancelled:true,start:null,end:null},fetcher)).toMatchObject({cancelled:true,version:null});
    await expect(readReviewedExternalEvent("microsoft","token",visit.id,"linked","reviewed",{cancelled:true,start:null,end:null},fetcher)).rejects.toThrow();
    await expect(readReviewedExternalEvent("microsoft","token",visit.id,"linked",null,reviewed,fetcher)).rejects.toThrow();
  });
});

describe("manager-confirmed reassignment cleanup",()=>{
 it("conditionally removes only the unchanged owned event",async()=>{
  const {removeReassignedExternalEvent}=await import("./calendar-provider-review");
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({id:"event",etag:"rev1",extendedProperties:{private:{surveyntAppointmentId:"visit"}}}))).mockResolvedValueOnce(new Response(null,{status:204}));
  await removeReassignedExternalEvent("google","token","visit","event","rev1",fetcher);
  expect(fetcher.mock.calls[1][1]).toMatchObject({method:"DELETE",headers:{"if-match":"rev1"}});
 });
 it("holds externally changed events for review",async()=>{
  const {removeReassignedExternalEvent}=await import("./calendar-provider-review");
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"event",etag:"rev2",extendedProperties:{private:{surveyntAppointmentId:"visit"}}})));
  await expect(removeReassignedExternalEvent("google","token","visit","event","rev1",fetcher)).rejects.toThrow("changed externally");expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("recovers a removal whose local transaction was interrupted",async()=>{
  const {removeReassignedExternalEvent}=await import("./calendar-provider-review");const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:404}));
  await expect(removeReassignedExternalEvent("microsoft","token","visit","event","rev1",fetcher)).resolves.toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
