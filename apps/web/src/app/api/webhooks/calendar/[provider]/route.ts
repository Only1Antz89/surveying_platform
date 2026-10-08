import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { backgroundJobs, calendarConnections, createDatabase } from "@surveynt/db";
import { validCalendarWebhookToken } from "@/lib/calendar-oauth";

const providerSchema = z.enum(["google", "microsoft"]);
async function enqueue(connection: typeof calendarConnections.$inferSelect, deduplicationKey: string) {
  await createDatabase(process.env.DATABASE_ADMIN_URL).insert(backgroundJobs).values({ organisationId: connection.organisationId, queue: "calendar", type: "calendar_reconcile", deduplicationKey, payload: { connectionId: connection.id } }).onConflictDoNothing();
}
export async function POST(request: Request, route: RouteContext<"/api/webhooks/calendar/[provider]">) {
  const { provider: rawProvider } = await route.params; const parsed = providerSchema.safeParse(rawProvider); if (!parsed.success || !process.env.DATABASE_ADMIN_URL) return new Response(null, { status: 404 }); const provider = parsed.data; const url = new URL(request.url);
  if (provider === "microsoft" && url.searchParams.has("validationToken")) return new Response(url.searchParams.get("validationToken"), { status: 200, headers: { "content-type": "text/plain" } });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  if (provider === "google") {
    const channelId = request.headers.get("x-goog-channel-id") ?? ""; const token = request.headers.get("x-goog-channel-token") ?? ""; const message = request.headers.get("x-goog-message-number") ?? crypto.randomUUID();
    const [connection] = await db.select().from(calendarConnections).where(and(eq(calendarConnections.provider, "google"), eq(calendarConnections.webhookChannelId, channelId), eq(calendarConnections.status, "active"))).limit(1); if (!connection || !validCalendarWebhookToken(connection.id, token)) return new Response(null, { status: 401 }); await enqueue(connection, `calendar-webhook:google:${connection.id}:${message}`); return new Response(null, { status: 204 });
  }
  const notifications=z.object({value:z.array(z.object({subscriptionId:z.string().max(2048).optional(),clientState:z.string().max(2048).optional(),resourceData:z.object({id:z.string().max(2048).optional()}).nullable().optional()})).max(1000)}).safeParse(await request.json().catch(()=>null));
  if(!notifications.success)return new Response(null,{status:400});
  const notificationBatchId=crypto.randomUUID();
  for (const item of notifications.data.value) { if (!item.subscriptionId || !item.clientState) continue; const [connection] = await db.select().from(calendarConnections).where(and(eq(calendarConnections.provider, "microsoft"), eq(calendarConnections.webhookChannelId, item.subscriptionId), eq(calendarConnections.status, "active"))).limit(1); if (!connection || !validCalendarWebhookToken(connection.id, item.clientState,connection.webhookAttemptId??undefined)) continue; await enqueue(connection, `calendar-webhook:microsoft:${connection.id}:${notificationBatchId}:${item.resourceData?.id ?? crypto.randomUUID()}`); }
  return new Response(null, { status: 202 });
}
