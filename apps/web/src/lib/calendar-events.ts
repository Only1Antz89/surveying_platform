import type { CalendarProvider } from "./calendar-oauth";
export type ExternalEvent = { id:string;start:Date|null;end:Date|null;version:string|null;surveyntAppointmentId:string|null;cancelled:boolean };

/** Read the complete window before replacing any persisted availability. */
export async function externalEvents(provider:CalendarProvider,accessToken:string,fetcher:typeof fetch=fetch){
  const min=new Date(Date.now()-30*86400000).toISOString(),max=new Date(Date.now()+120*86400000).toISOString();
  const first=new URL(provider==="google"?"https://www.googleapis.com/calendar/v3/calendars/primary/events":"https://graph.microsoft.com/v1.0/me/calendarView");
  if(provider==="google"){first.searchParams.set("singleEvents","true");first.searchParams.set("showDeleted","true");first.searchParams.set("maxResults","2500");first.searchParams.set("timeMin",min);first.searchParams.set("timeMax",max);}
  else{first.searchParams.set("startDateTime",min);first.searchParams.set("endDateTime",max);first.searchParams.set("$top","999");first.searchParams.set("$select","id,start,end,isCancelled,categories,changeKey");}
  let next:URL|null=first;const seen=new Set<string>(),events=new Map<string,ExternalEvent>();
  while(next){
    if(seen.has(next.href)||seen.size>=100)throw new Error("Calendar pagination did not complete. Existing availability is retained.");
    seen.add(next.href);
    const response=await fetcher(next.href,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${accessToken}`,prefer:'outlook.timezone="UTC"'}});
    if(!response.ok)throw new Error("Calendar events could not be read.");
    const body=await response.json() as Record<string,unknown>,rows=provider==="google"?body.items:body.value;
    if(!Array.isArray(rows))throw new Error("Calendar returned an invalid event page.");
    for(const raw of rows){
      if(!raw||typeof raw!=="object")throw new Error("Calendar returned an invalid event.");
      const event=raw as Record<string,unknown>,startObject=event.start as Record<string,unknown>|undefined,endObject=event.end as Record<string,unknown>|undefined;
      const date=(value:unknown)=>{let text=String(value??"");if(provider==="microsoft"&&text.includes("T")&&!/(Z|[+-]\d{2}:\d{2})$/i.test(text))text+="Z";return new Date(text);};
      const start=date(startObject?.dateTime??startObject?.date),end=date(endObject?.dateTime??endObject?.date);
      const cancelled=event.status==="cancelled"||event.isCancelled===true;
      if(typeof event.id!=="string"||!event.id||(!cancelled&&(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)))throw new Error("Calendar returned an invalid event interval.");
      const properties=(event.extendedProperties as Record<string,Record<string,string>>|undefined)?.private,categories=Array.isArray(event.categories)?event.categories.map(String):[];
      events.set(event.id,{id:event.id,start:Number.isNaN(start.getTime())?null:start,end:Number.isNaN(end.getTime())?null:end,version:String(event.etag??event.changeKey??"")||null,surveyntAppointmentId:properties?.surveyntAppointmentId??categories.find(item=>item.startsWith("surveynt:"))?.slice(9)??null,cancelled});
    }
    if(provider==="google"){
      const token=body.nextPageToken;if(token!==undefined&&(typeof token!=="string"||!token))throw new Error("Calendar returned an invalid page token.");
      next=token?new URL(first.href):null;if(next)next.searchParams.set("pageToken",token as string);
    }else{
      const link=body["@odata.nextLink"];if(link!==undefined&&typeof link!=="string")throw new Error("Calendar returned an invalid continuation link.");
      next=link?new URL(link as string):null;
      if(next&&(next.origin!==first.origin||next.pathname!==first.pathname||next.username||next.password||next.hash))throw new Error("Calendar returned an unexpected continuation endpoint.");
    }
  }
  return [...events.values()];
}
