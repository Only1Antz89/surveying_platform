import {z} from "zod";
import {calendarWebhookToken} from "./calendar-oauth";
import {CalendarSubscriptionError} from "./calendar-subscription";

/** The caller must durably record channelId before dispatching this creation request. */
export async function createGoogleReplacementChannel(connectionId:string,accessToken:string,origin:string,channelId:string){
 if(!z.uuid().safeParse(channelId).success||!accessToken)throw new CalendarSubscriptionError(true);
 let notificationUrl:string;
 try{
  const base=new URL(origin);
  if(base.protocol!=="https:"||base.username||base.password||base.pathname!=="/"||base.search||base.hash)throw new Error();
  notificationUrl=new URL("/api/webhooks/calendar/google",base).toString();
 }catch{throw new CalendarSubscriptionError(true);}
 let response:Response;
 try{
  response=await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({id:channelId,type:"web_hook",address:notificationUrl,token:calendarWebhookToken(connectionId),params:{ttl:"604800"}})});
 }catch{
  // The provider may have created the channel. A new random ID would create another one.
  throw new CalendarSubscriptionError(true);
 }
 if(!response.ok)throw new CalendarSubscriptionError(response.status!==429);
 try{
  const body=z.object({id:z.string(),resourceId:z.string().min(1).max(2048),expiration:z.string().regex(/^\d+$/)}).parse(await response.json());
  const expiresAt=new Date(Number(body.expiration));
  if(body.id!==channelId||!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now()+60000||expiresAt.getTime()>Date.now()+8*86400000)throw new Error();
  return {channelId:body.id,resourceId:body.resourceId,expiresAt};
 }catch{throw new CalendarSubscriptionError(true);}
}
