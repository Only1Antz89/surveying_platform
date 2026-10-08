import { describe,expect,it,vi } from "vitest";
import { externalEvents } from "./calendar-events";
const event=(id:string)=>({id,start:{dateTime:"2026-10-07T09:00:00Z"},end:{dateTime:"2026-10-07T10:00:00Z"}});
const json=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
describe("complete calendar event windows",()=>{
  it("follows Google page tokens and preserves window parameters",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(json({items:[event("first")],nextPageToken:"next-token"})).mockResolvedValueOnce(json({items:[event("second")]}));
    expect((await externalEvents("google","local-token",fetcher)).map(e=>e.id)).toEqual(["first","second"]);
    const first=new URL(fetcher.mock.calls[0][0]),second=new URL(fetcher.mock.calls[1][0]);expect(first.searchParams.get("showDeleted")).toBe("true");expect(second.searchParams.get("pageToken")).toBe("next-token");expect(second.searchParams.get("timeMin")).toBe(first.searchParams.get("timeMin"));
  });
  it("follows Graph links exactly and interprets the requested UTC times",async()=>{
    const next="https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=opaque";
    const fetcher=vi.fn().mockResolvedValueOnce(json({value:[event("first")],"@odata.nextLink":next})).mockResolvedValueOnce(json({value:[{...event("second"),start:{dateTime:"2026-10-07T09:00:00"},end:{dateTime:"2026-10-07T10:00:00"}}]}));
    const rows=await externalEvents("microsoft","local-token",fetcher);expect(fetcher.mock.calls[1][0]).toBe(next);expect(rows[1].start!.toISOString()).toBe("2026-10-07T09:00:00.000Z");
  });
  it("retains cancelled tombstones without inventing times",async()=>{
    const rows=await externalEvents("google","local-token",vi.fn().mockResolvedValue(json({items:[{id:"cancelled",status:"cancelled"}]})));expect(rows[0]).toMatchObject({cancelled:true,start:null,end:null});
  });
  it("continues empty pages and deduplicates repeated event identities",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(json({items:[],nextPageToken:"empty"})).mockResolvedValueOnce(json({items:[event("repeat")],nextPageToken:"last"})).mockResolvedValueOnce(json({items:[{...event("repeat"),etag:"new-version"},event("last")]}));
    const rows=await externalEvents("google","local-token",fetcher);expect(rows.map(row=>row.id)).toEqual(["repeat","last"]);expect(rows[0].version).toBe("new-version");expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:"error",signal:expect.any(AbortSignal)});
  });
  it("rejects unsafe continuation targets before forwarding credentials",async()=>{
    for(const next of ["https://example.test/steal","https://graph.microsoft.com/v1.0/me/messages","https://user:pass@graph.microsoft.com/v1.0/me/calendarView"]){
      const fetcher=vi.fn().mockResolvedValue(json({value:[],"@odata.nextLink":next}));await expect(externalEvents("microsoft","local-token",fetcher)).rejects.toThrow("unexpected continuation");expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects loops, failed later pages and malformed active intervals",async()=>{
    const looping=vi.fn().mockImplementation(async()=>json({items:[],nextPageToken:"repeat"}));await expect(externalEvents("google","local-token",looping)).rejects.toThrow("pagination");
    const failed=vi.fn().mockResolvedValueOnce(json({items:[event("first")],nextPageToken:"next"})).mockResolvedValueOnce(new Response("failure",{status:503}));await expect(externalEvents("google","local-token",failed)).rejects.toThrow("could not be read");
    await expect(externalEvents("google","local-token",vi.fn().mockResolvedValue(json({items:[{id:"invalid"}]})))).rejects.toThrow("invalid event interval");
  });
});
