import {timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {CalendarSubscriptionError} from "./calendar-subscription";
const record=z.object({id:z.string().min(1).max(2048),applicationId:z.string().min(1),resource:z.string(),notificationUrl:z.string().url(),clientState:z.string().min(1),changeType:z.string(),expirationDateTime:z.string().datetime({offset:true})});
type Expected={subscriptionId:string;providerAccountId:string;applicationId:string;notificationUrl:string;clientState:string};
/** Read the exact record; a subscription list or entered ID is not ownership proof. */
export async function verifyMicrosoftCalendarSubscription(accessToken:string,expected:Expected){
 if(!accessToken||!expected.subscriptionId||expected.subscriptionId.length>2048||!expected.providerAccountId||!expected.applicationId||!expected.clientState)throw new CalendarSubscriptionError(true);
 let owner:Response,response:Response;
 try{
  owner=await fetch("https://graph.microsoft.com/v1.0/me?$select=id",{redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${accessToken}`}});
  if(!owner.ok)throw new Error();
  const profile=z.object({id:z.string()}).parse(await owner.json());if(profile.id!==expected.providerAccountId)throw new Error();
  response=await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(expected.subscriptionId)}`,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${accessToken}`}});
  if(!response.ok)throw new Error();
  const body=record.parse(await response.json()),actualState=Buffer.from(body.clientState),expectedState=Buffer.from(expected.clientState);
  if(body.id!==expected.subscriptionId||body.applicationId.toLowerCase()!==expected.applicationId.toLowerCase()||body.resource!=="me/events"||body.notificationUrl!==expected.notificationUrl||actualState.length!==expectedState.length||!timingSafeEqual(actualState,expectedState)||body.changeType.split(",").map(value=>value.trim()).sort().join(",")!=="created,deleted,updated")throw new Error();
  const expiresAt=new Date(body.expirationDateTime);if(expiresAt.getTime()<=Date.now()+60000||expiresAt.getTime()>Date.now()+3*86400000)throw new Error();
  return {channelId:body.id,resourceId:null,expiresAt};
 }catch{throw new CalendarSubscriptionError(true);}
}
