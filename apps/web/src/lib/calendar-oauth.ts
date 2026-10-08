import {workspaceModes,type WorkspaceMode} from "./workspace-mode";
import { z } from "zod";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type CalendarProvider = "google" | "microsoft";
type State = { provider: CalendarProvider; organisationId: string; userId: string; verifier: string; expires: number; workspaceMode?:WorkspaceMode };

export function calendarEncryptionKeyVersion(){
  const value=process.env.CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION??"1";
  if(!/^[1-9]\d{0,5}$/.test(value))throw new Error("Invalid calendar encryption key version.");
  return Number(value);
}
function key(version=calendarEncryptionKeyVersion()) {
  const active=calendarEncryptionKeyVersion();let value:string|undefined;
  if(version===active)value=process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  else{
    try{
      const previous=JSON.parse(process.env.CALENDAR_TOKEN_ENCRYPTION_PREVIOUS_KEYS??"{}");
      if(!previous||typeof previous!=="object"||Array.isArray(previous))throw new Error();
      value=Object.hasOwn(previous,String(version))?previous[String(version)]:undefined;
    }catch{throw new Error("Invalid previous calendar encryption keys.");}
  }
  if(typeof value!=="string")throw new Error("The calendar encryption key is unavailable.");
  const decoded=Buffer.from(value,"base64");
  if(decoded.length!==32)throw new Error("Calendar encryption keys must contain 32 bytes.");
  return decoded;
}
export function calendarSecretUsesActiveKey(value:string){return value.startsWith(`v2.${calendarEncryptionKeyVersion()}.`);}
export function encryptCalendarSecret(value:unknown){
  const version=calendarEncryptionKeyVersion(),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(version),iv);
  cipher.setAAD(Buffer.from(`v2.${version}`));
  const body=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return ["v2",String(version),iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),body.toString("base64url")].join(".");
}
export function decryptCalendarSecret<T>(value:string):T{
  const parts=value.split("."),legacy=parts[0]==="v1"&&parts.length===4,modern=parts[0]==="v2"&&parts.length===5;
  if(!legacy&&!modern)throw new Error("Unsupported encrypted calendar credential.");
  const version=legacy?1:Number(parts[1]);
  if(!legacy&&!/^[1-9]\d{0,5}$/.test(parts[1]))throw new Error("Unsupported calendar credential key version.");
  const [iv,tag,body]=parts.slice(legacy?1:2);
  if(![iv,tag,body].every(part=>/^[A-Za-z0-9_-]+$/.test(part))||Buffer.from(iv,"base64url").length!==12||Buffer.from(tag,"base64url").length!==16)throw new Error("Invalid encrypted calendar credential.");
  const decipher=createDecipheriv("aes-256-gcm",key(version),Buffer.from(iv,"base64url"));
  if(modern)decipher.setAAD(Buffer.from(`v2.${version}`));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,"base64url")),decipher.final()]).toString("utf8")) as T;
}

const config = (provider: CalendarProvider) => provider === "google" ? {
  clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
} : {
  clientId: process.env.MICROSOFT_CALENDAR_CLIENT_ID, clientSecret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
  authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", scope: "openid email offline_access User.Read Calendars.ReadWrite",
};

export function calendarRedirectUri(origin: string) { return `${origin}/api/v1/calendar/oauth/callback`; }
export function calendarWebhookToken(connectionId: string,attemptId?:string) {
  if (!process.env.CALENDAR_WEBHOOK_SECRET) throw new Error("CALENDAR_WEBHOOK_SECRET is required.");
  return createHmac("sha256", process.env.CALENDAR_WEBHOOK_SECRET).update(attemptId?`attempt:${connectionId}:${z.uuid().parse(attemptId)}`:connectionId).digest("base64url");
}
export function validCalendarWebhookToken(connectionId: string, candidate: string,attemptId?:string) {
  try { const expected = Buffer.from(calendarWebhookToken(connectionId,attemptId)); const actual = Buffer.from(candidate); return expected.length === actual.length && timingSafeEqual(expected, actual); } catch { return false; }
}

export async function registerCalendarWebhook(provider: CalendarProvider, connectionId: string, accessToken: string, origin: string, recordedChannelId?:string,registrationAttemptId?:string) {
  if (!process.env.CALENDAR_WEBHOOK_SECRET) return null;
  const notificationUrl = `${origin}/api/webhooks/calendar/${provider}`;
  if (provider === "google") {
    const channelId = recordedChannelId??randomUUID(); const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events/watch", { method: "POST", redirect:"error", signal:AbortSignal.timeout(15000), headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ id: channelId, type: "web_hook", address: notificationUrl, token: calendarWebhookToken(connectionId), params: { ttl: "604800" } }) }); const body = await response.json() as { id?: string; resourceId?:string; expiration?: string }; if (!response.ok || !body.id || recordedChannelId&&body.id!==recordedChannelId) throw new Error("Google Calendar webhook registration failed."); return { channelId: body.id, resourceId:typeof body.resourceId==="string"&&body.resourceId?body.resourceId:null, expiresAt: typeof body.expiration==="string"&&/^\d+$/.test(body.expiration)&&Number.isFinite(new Date(Number(body.expiration)).getTime()) ? new Date(Number(body.expiration)) : null };
  }
  const expirationDateTime = new Date(Date.now() + 2.5 * 86_400_000).toISOString(); const response = await fetch("https://graph.microsoft.com/v1.0/subscriptions", { method: "POST", redirect:"error", signal:AbortSignal.timeout(15000), headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl, resource: "me/events", expirationDateTime, clientState: calendarWebhookToken(connectionId,registrationAttemptId) }) }); const body = await response.json() as { id?: string; expirationDateTime?: string }; if (!response.ok || !body.id) throw new Error("Microsoft Calendar webhook registration failed."); return { channelId: body.id, resourceId:null, expiresAt: typeof body.expirationDateTime==="string"&&Number.isFinite(new Date(body.expirationDateTime).getTime()) ? new Date(body.expirationDateTime) : null };
}
export function createCalendarAuthorization(provider: CalendarProvider, identity: { organisationId: string; userId: string;workspaceMode?:WorkspaceMode }, origin: string) {
  const providerConfig = config(provider); if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error("CALENDAR_PROVIDER_NOT_CONFIGURED");
  const verifier = randomBytes(48).toString("base64url"); const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = encryptCalendarSecret({ provider, ...identity, verifier, expires: Date.now() + 10 * 60_000 } satisfies State);
  const url = new URL(providerConfig.authorize); url.searchParams.set("client_id", providerConfig.clientId); url.searchParams.set("redirect_uri", calendarRedirectUri(origin)); url.searchParams.set("response_type", "code"); url.searchParams.set("scope", providerConfig.scope); url.searchParams.set("state", state); url.searchParams.set("code_challenge", challenge); url.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") { url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
  return url.toString();
}

export async function exchangeCalendarCode(stateValue:string,code:string,origin:string,identity:{organisationId:string;userId:string}) {
  const state=readCalendarState(stateValue);
  if(state.organisationId!==identity.organisationId||state.userId!==identity.userId)throw new Error("CALENDAR_OAUTH_IDENTITY_MISMATCH");
  const providerConfig = config(state.provider); if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error("CALENDAR_PROVIDER_NOT_CONFIGURED");
  const response = await fetch(providerConfig.token, { method: "POST", redirect:"error", signal:AbortSignal.timeout(15000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: providerConfig.clientId, client_secret: providerConfig.clientSecret, redirect_uri: calendarRedirectUri(origin), grant_type: "authorization_code", code, code_verifier: state.verifier }) });
  const tokens = await response.json() as Record<string, unknown>; if (!response.ok || typeof tokens.access_token !== "string") throw new Error("CALENDAR_TOKEN_EXCHANGE_FAILED");
  const profileUrl = state.provider === "google" ? "https://www.googleapis.com/oauth2/v3/userinfo" : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName";
  const profileResponse = await fetch(profileUrl, { redirect:"error", signal:AbortSignal.timeout(15000), headers: { authorization: `Bearer ${tokens.access_token}` } }); const profile = await profileResponse.json() as Record<string, unknown>;
  if (!profileResponse.ok || typeof profile.id !== "string" && typeof profile.sub !== "string") throw new Error("CALENDAR_PROFILE_FAILED");
  const storedTokens = { ...tokens, access_token: tokens.access_token, obtained_at: Date.now() } as Record<string, unknown> & { access_token: string; obtained_at: number };
  return { state, tokens: storedTokens, providerAccountId: String(profile.id ?? profile.sub), accountEmail: String(profile.email ?? profile.mail ?? profile.userPrincipalName ?? "") };
}

export function readCalendarState(stateValue:string){const state=z.object({provider:z.enum(["google","microsoft"]),organisationId:z.string().min(1),userId:z.string().min(1),verifier:z.string().min(43).max(128),expires:z.number().int().finite(),workspaceMode:z.enum(workspaceModes).optional()}).parse(decryptCalendarSecret<unknown>(stateValue));if(state.expires<=Date.now())throw new Error("CALENDAR_OAUTH_EXPIRED");return state;}
