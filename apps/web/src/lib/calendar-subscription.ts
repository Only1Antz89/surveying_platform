import type { CalendarProvider } from "./calendar-oauth";
import { z } from "zod";

export const cleanupTokensSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().optional(),obtained_at:z.number().finite().nonnegative().optional(),expires_in:z.number().finite().positive().optional()});
export async function refreshCleanupTokens(provider:CalendarProvider,tokens:z.infer<typeof cleanupTokensSchema>){
  // Historical metadata may be absent. The exact provider operation validates the token; do not invent a lifetime.
  const lifetimeKnown=tokens.obtained_at!==undefined&&tokens.expires_in!==undefined;
  if(!lifetimeKnown&&!tokens.refresh_token)return tokens;
  if(lifetimeKnown&&tokens.obtained_at!+tokens.expires_in!*1000>Date.now()+60000)return tokens;
  const google=provider==="google",clientId=google?process.env.GOOGLE_CALENDAR_CLIENT_ID:process.env.MICROSOFT_CALENDAR_CLIENT_ID,clientSecret=google?process.env.GOOGLE_CALENDAR_CLIENT_SECRET:process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  if(!tokens.refresh_token||!clientId||!clientSecret)throw new CalendarSubscriptionError(true);
  let response:Response;
  try{response=await fetch(google?"https://oauth2.googleapis.com/token":"https://login.microsoftonline.com/common/oauth2/v2.0/token",{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"refresh_token",refresh_token:tokens.refresh_token,...(google?{}:{scope:"openid email offline_access User.Read Calendars.ReadWrite"})})});}
  catch{throw new CalendarSubscriptionError(true);}
  // A lost refresh response may rotate the refresh token. Preserve the snapshot for review.
  if(!response.ok)throw new CalendarSubscriptionError(response.status!==429&&response.status<500);
  try{
    const body=z.object({access_token:z.string().min(1),expires_in:z.number().positive(),refresh_token:z.string().min(1).optional()}).parse(await response.json());
    return {...tokens,...body,obtained_at:Date.now()};
  }catch{throw new CalendarSubscriptionError(true);}
}

export class CalendarSubscriptionError extends Error {
  constructor(public readonly reviewRequired: boolean) {
    super(reviewRequired ? "Calendar subscription cleanup requires review." : "Calendar subscription cleanup can be retried.");
  }
}

/** Graph renews the recorded subscription rather than creating a replacement. */
export async function renewMicrosoftSubscription(accessToken:string,channelId:string){
  if(!accessToken||!channelId||channelId.length>2048)throw new CalendarSubscriptionError(true);
  const requestedExpiry=new Date(Date.now()+2.5*86400000);
  let response:Response;
  try{
    response=await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(channelId)}`,{method:"PATCH",redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({expirationDateTime:requestedExpiry.toISOString()})});
  }catch{throw new CalendarSubscriptionError(false);}
  if(!response.ok)throw new CalendarSubscriptionError(response.status<500&&response.status!==429);
  try{
    const body=z.object({id:z.string(),expirationDateTime:z.string().datetime({offset:true})}).parse(await response.json());
    const expiresAt=new Date(body.expirationDateTime);
    if(body.id!==channelId||expiresAt.getTime()<=Date.now()+60000||expiresAt.getTime()>requestedExpiry.getTime()+60000)throw new Error();
    return {channelId:body.id,expiresAt};
  }catch{throw new CalendarSubscriptionError(true);}
}

/** Stops only the recorded subscription; credentials and provider responses never enter errors. */
export async function stopCalendarSubscription(provider: CalendarProvider, accessToken: string, channelId: string, resourceId: string | null) {
  if (!accessToken || !channelId || channelId.length > 2048 || (provider === "google" && !resourceId)) throw new CalendarSubscriptionError(true);
  const google = provider === "google";
  let response: Response;
  try {
    response = await fetch(google ? "https://www.googleapis.com/calendar/v3/channels/stop" : `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(channelId)}`, {
      method: google ? "POST" : "DELETE", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${accessToken}`, ...(google ? { "content-type": "application/json" } : {}) },
      ...(google ? { body: JSON.stringify({ id: channelId, resourceId }) } : {}),
    });
  } catch { throw new CalendarSubscriptionError(false); }
  if ([200,204,404,410].includes(response.status)) return;
  throw new CalendarSubscriptionError(response.status < 500 && response.status !== 429);
}
