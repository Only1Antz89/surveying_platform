import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type CalendarProvider = "google" | "microsoft";
type State = { provider: CalendarProvider; organisationId: string; userId: string; verifier: string; expires: number };

function key() {
  const value = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY is required.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return decoded;
}

export function encryptCalendarSecret(value: unknown) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptCalendarSecret<T>(value: string): T {
  const [version, iv, tag, body] = value.split("."); if (version !== "v1" || !iv || !tag || !body) throw new Error("Unsupported encrypted calendar credential.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as T;
}

const config = (provider: CalendarProvider) => provider === "google" ? {
  clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
} : {
  clientId: process.env.MICROSOFT_CALENDAR_CLIENT_ID, clientSecret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
  authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", scope: "openid email offline_access User.Read Calendars.ReadWrite",
};

export function calendarRedirectUri(origin: string) { return `${origin}/api/v1/calendar/oauth/callback`; }
export function calendarWebhookToken(connectionId: string) {
  if (!process.env.CALENDAR_WEBHOOK_SECRET) throw new Error("CALENDAR_WEBHOOK_SECRET is required.");
  return createHmac("sha256", process.env.CALENDAR_WEBHOOK_SECRET).update(connectionId).digest("base64url");
}
export function validCalendarWebhookToken(connectionId: string, candidate: string) {
  try { const expected = Buffer.from(calendarWebhookToken(connectionId)); const actual = Buffer.from(candidate); return expected.length === actual.length && timingSafeEqual(expected, actual); } catch { return false; }
}

export async function registerCalendarWebhook(provider: CalendarProvider, connectionId: string, accessToken: string, origin: string) {
  if (!process.env.CALENDAR_WEBHOOK_SECRET) return null;
  const notificationUrl = `${origin}/api/webhooks/calendar/${provider}`;
  if (provider === "google") {
    const channelId = randomUUID(); const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events/watch", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ id: channelId, type: "web_hook", address: notificationUrl, token: calendarWebhookToken(connectionId), params: { ttl: "604800" } }) }); const body = await response.json() as { id?: string; expiration?: string }; if (!response.ok || !body.id) throw new Error("Google Calendar webhook registration failed."); return { channelId: body.id, expiresAt: body.expiration ? new Date(Number(body.expiration)) : new Date(Date.now() + 7 * 86_400_000) };
  }
  const expirationDateTime = new Date(Date.now() + 2.5 * 86_400_000).toISOString(); const response = await fetch("https://graph.microsoft.com/v1.0/subscriptions", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl, resource: "me/events", expirationDateTime, clientState: calendarWebhookToken(connectionId) }) }); const body = await response.json() as { id?: string; expirationDateTime?: string }; if (!response.ok || !body.id) throw new Error("Microsoft Calendar webhook registration failed."); return { channelId: body.id, expiresAt: new Date(body.expirationDateTime ?? expirationDateTime) };
}
export function createCalendarAuthorization(provider: CalendarProvider, identity: { organisationId: string; userId: string }, origin: string) {
  const providerConfig = config(provider); if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error("CALENDAR_PROVIDER_NOT_CONFIGURED");
  const verifier = randomBytes(48).toString("base64url"); const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = encryptCalendarSecret({ provider, ...identity, verifier, expires: Date.now() + 10 * 60_000 } satisfies State);
  const url = new URL(providerConfig.authorize); url.searchParams.set("client_id", providerConfig.clientId); url.searchParams.set("redirect_uri", calendarRedirectUri(origin)); url.searchParams.set("response_type", "code"); url.searchParams.set("scope", providerConfig.scope); url.searchParams.set("state", state); url.searchParams.set("code_challenge", challenge); url.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") { url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
  return url.toString();
}

export async function exchangeCalendarCode(stateValue: string, code: string, origin: string) {
  const state = decryptCalendarSecret<State>(stateValue); if (state.expires < Date.now()) throw new Error("CALENDAR_OAUTH_EXPIRED");
  const providerConfig = config(state.provider); if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error("CALENDAR_PROVIDER_NOT_CONFIGURED");
  const response = await fetch(providerConfig.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: providerConfig.clientId, client_secret: providerConfig.clientSecret, redirect_uri: calendarRedirectUri(origin), grant_type: "authorization_code", code, code_verifier: state.verifier }) });
  const tokens = await response.json() as Record<string, unknown>; if (!response.ok || typeof tokens.access_token !== "string") throw new Error("CALENDAR_TOKEN_EXCHANGE_FAILED");
  const profileUrl = state.provider === "google" ? "https://www.googleapis.com/oauth2/v3/userinfo" : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName";
  const profileResponse = await fetch(profileUrl, { headers: { authorization: `Bearer ${tokens.access_token}` } }); const profile = await profileResponse.json() as Record<string, unknown>;
  if (!profileResponse.ok || typeof profile.id !== "string" && typeof profile.sub !== "string") throw new Error("CALENDAR_PROFILE_FAILED");
  const storedTokens = { ...tokens, access_token: tokens.access_token, obtained_at: Date.now() } as Record<string, unknown> & { access_token: string; obtained_at: number };
  return { state, tokens: storedTokens, providerAccountId: String(profile.id ?? profile.sub), accountEmail: String(profile.email ?? profile.mail ?? profile.userPrincipalName ?? "") };
}
