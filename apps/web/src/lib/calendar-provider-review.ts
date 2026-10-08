import type { CalendarProvider } from "./calendar-oauth";
export class CalendarReviewError extends Error{constructor(message:string,readonly status=409){super(message);}}
type Visit={id:string;startsAt:Date;endsAt:Date};
export async function restoreExternalTime(provider:CalendarProvider,token:string,visit:Visit,eventId:string,reviewedVersion:string|null,fetcher:typeof fetch=fetch){
  const google=provider==="google",url=google?`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`:`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
  const headers={authorization:`Bearer ${token}`,prefer:'outlook.timezone="UTC"'};
  async function read(){
    const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(15000),headers});
    if(!response.ok)throw new CalendarReviewError("The linked provider event could not be read. Synchronise and review it again.",response.status===404?409:502);
    const body=await response.json() as Record<string,unknown>;
    const marker=google?(body.extendedProperties as {private?:{surveyntAppointmentId?:string}}|undefined)?.private?.surveyntAppointmentId:Array.isArray(body.categories)?body.categories.find(value=>value===`surveynt:${visit.id}`):undefined;
    if(body.id!==eventId||marker!==(google?visit.id:`surveynt:${visit.id}`))throw new CalendarReviewError("The provider event identity no longer matches this appointment.");
    if(body.status==="cancelled"||body.isCancelled===true)throw new CalendarReviewError("The provider event was cancelled. It requires a reviewed replacement.");
    const rawVersion=body.etag??body.changeKey;const version=typeof rawVersion==="string"&&rawVersion?rawVersion:null;
    const parse=(value:unknown)=>{let text=String(value??"");if(!google&&text.includes("T")&&!/(Z|[+-]\d{2}:\d{2})$/i.test(text))text+="Z";return new Date(text).getTime();};
    const start=parse((body.start as {dateTime?:string}|undefined)?.dateTime),end=parse((body.end as {dateTime?:string}|undefined)?.dateTime);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new CalendarReviewError("The provider returned an invalid appointment period. No update was sent.",502);
    const matches=Math.abs(start-visit.startsAt.getTime())<=1000&&Math.abs(end-visit.endsAt.getTime())<=1000;
    return {version,matches,etag:google?body.etag:body["@odata.etag"]??response.headers.get("etag")};
  }
  const current=await read();
  // Recover a successful PATCH whose response or local transaction was lost.
  if(current.matches&&current.version)return {version:current.version,changed:false};
  if(!reviewedVersion||current.version!==reviewedVersion)throw new CalendarReviewError("The provider event changed after review. Synchronise and review its latest times.");
  if(typeof current.etag!=="string"||!current.etag)throw new CalendarReviewError("The provider did not supply a conditional-update revision. No update was sent.");
  const payload={start:{dateTime:visit.startsAt.toISOString(),...(!google?{timeZone:"UTC"}:{})},end:{dateTime:visit.endsAt.toISOString(),...(!google?{timeZone:"UTC"}:{})}};
  const response=await fetcher(url,{method:"PATCH",redirect:"error",signal:AbortSignal.timeout(15000),headers:{...headers,"content-type":"application/json","if-match":current.etag},body:JSON.stringify(payload)});
  if(!response.ok)throw new CalendarReviewError(response.status===412?"The provider event changed during review. Synchronise and review it again.":"The provider appointment update failed. The conflict remains open.",response.status===412?409:502);
  const verified=await read();if(!verified.matches||!verified.version)throw new CalendarReviewError("Provider times could not be confirmed. The conflict remains open.",502);
  return {version:verified.version,changed:true};
}

/** The replacement identity belongs to the reviewed conflict, making retries reuse it. */
export async function replaceCancelledExternalEvent(provider:CalendarProvider,token:string,visit:Visit,eventId:string,reviewedVersion:string|null,connectionId:string,conflictId:string,fetcher:typeof fetch=fetch){
  const google=provider==="google",url=google?`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`:`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
  const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`}});
  if(response.status!==404){
    if(!response.ok)throw new CalendarReviewError("Provider cancellation could not be confirmed. The conflict remains open.",502);
    const body=await response.json() as Record<string,unknown>;
    if(body.id!==eventId||!(body.status==="cancelled"||body.isCancelled===true))throw new CalendarReviewError("The provider event is no longer cancelled. Synchronise and review it again.");
    if(reviewedVersion!==null&&(body.etag??body.changeKey)!==reviewedVersion)throw new CalendarReviewError("The cancelled provider event changed after review.");
  }
  const {createExternalEvent}=await import("./calendar-export");
  const replacement=await createExternalEvent(provider,token,visit,`${connectionId}:replacement:${conflictId}`,fetcher);
  const verified=await restoreExternalTime(provider,token,visit,replacement.id,replacement.version,fetcher);
  return {id:replacement.id,version:verified.version,changed:true};
}

/** Confirms the exact reviewed provider snapshot without changing either calendar. */
export async function readReviewedExternalEvent(provider:CalendarProvider,token:string,visitId:string,eventId:string,reviewedVersion:string|null,reviewed:{cancelled:boolean;start:string|null;end:string|null},fetcher:typeof fetch=fetch){
  const google=provider==="google",url=google?`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`:`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
  const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`,prefer:'outlook.timezone="UTC"'}});
  if(response.status===404&&reviewed.cancelled&&reviewedVersion===null)return {id:eventId,version:null,cancelled:true as const,start:null,end:null};
  if(!response.ok)throw new CalendarReviewError("The reviewed provider event could not be confirmed. Synchronise and review it again.",response.status===404?409:502);
  const body=await response.json() as Record<string,unknown>;
  if(body.id!==eventId)throw new CalendarReviewError("The provider event identity changed after review.");
  const cancelled=body.status==="cancelled"||body.isCancelled===true;
  const rawVersion=body.etag??body.changeKey,version=typeof rawVersion==="string"&&rawVersion?rawVersion:null;
  if(cancelled!==reviewed.cancelled||version!==reviewedVersion||(!cancelled&&!version))throw new CalendarReviewError("The provider event changed after review. Synchronise and review it again.");
  if(cancelled)return {id:eventId,version,cancelled:true as const,start:null,end:null};
  const marker=google?(body.extendedProperties as {private?:{surveyntAppointmentId?:string}}|undefined)?.private?.surveyntAppointmentId:Array.isArray(body.categories)?body.categories.find(value=>value===`surveynt:${visitId}`):undefined;
  if(marker!==(google?visitId:`surveynt:${visitId}`))throw new CalendarReviewError("The provider event no longer belongs to this appointment.");
  function instant(value:unknown,timeZone?:unknown){
    if(typeof value!=="string"||!value.includes("T"))return NaN;
    const qualified=/(Z|[+-]\d{2}:\d{2})$/i.test(value);
    if(!qualified&&(google||timeZone!=="UTC"))return NaN;
    return new Date(qualified?value:`${value}Z`).getTime();
  }
  const periodStart=body.start as {dateTime?:unknown;timeZone?:unknown}|undefined,periodEnd=body.end as {dateTime?:unknown;timeZone?:unknown}|undefined;
  const start=instant(periodStart?.dateTime,periodStart?.timeZone),end=instant(periodEnd?.dateTime,periodEnd?.timeZone);
  const expectedStart=instant(reviewed.start),expectedEnd=instant(reviewed.end);
  if(![start,end,expectedStart,expectedEnd].every(Number.isFinite)||end<=start||expectedEnd<=expectedStart)throw new CalendarReviewError("The reviewed appointment period is invalid. No change was accepted.");
  if(Math.abs(start-expectedStart)>1000||Math.abs(end-expectedEnd)>1000)throw new CalendarReviewError("The provider times changed after review. Synchronise and review them again.");
  return {id:eventId,version,cancelled:false as const,start:new Date(start),end:new Date(end)};
}
