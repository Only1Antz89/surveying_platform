import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { auditEvents, backgroundJobs, calendarConnections, createDatabase, withTenant } from "@surveynt/db";
import { and, eq } from "drizzle-orm";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
import { exchangeCalendarCode, encryptCalendarSecret, registerCalendarWebhook } from "@/lib/calendar-oauth";

export async function GET(request: Request) {
  const context = await apiContext(request); const url = new URL(request.url); const stateValue = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (!context?.internalUserId || !stateValue || !code) return Response.redirect(new URL("/?calendar=denied", url.origin));
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context) || context.demo || await isDemoOrganisation(context.organisationId)) return Response.redirect(new URL("/account?calendar=denied", url.origin));
  try {
    const exchange = await exchangeCalendarCode(stateValue, code, url.origin);
    if (exchange.state.organisationId !== context.organisationId || exchange.state.userId !== context.internalUserId) return Response.redirect(new URL("/?calendar=identity_mismatch", url.origin));
    const connection = await withTenant(createDatabase(), context.organisationId, async (tx) => {
      const [existing] = await tx.select({userId:calendarConnections.userId}).from(calendarConnections).where(and(eq(calendarConnections.organisationId,context.organisationId),eq(calendarConnections.provider,exchange.state.provider),eq(calendarConnections.providerAccountId,exchange.providerAccountId))).limit(1);
      if(existing && existing.userId !== context.internalUserId) throw new Error("CALENDAR_ACCOUNT_ALREADY_CONNECTED");
      const [connection] = await tx.insert(calendarConnections).values({ organisationId: context.organisationId, userId: context.internalUserId!, provider: exchange.state.provider, providerAccountId: exchange.providerAccountId, encryptedCredentials: encryptCalendarSecret(exchange.tokens), status: "active" }).onConflictDoUpdate({ target: [calendarConnections.organisationId, calendarConnections.provider, calendarConnections.providerAccountId], set: { encryptedCredentials: encryptCalendarSecret(exchange.tokens), status: "active", lastError: null, updatedAt: new Date() } }).returning();
      if(connection.userId !== context.internalUserId) throw new Error("CALENDAR_ACCOUNT_ALREADY_CONNECTED");
      await tx.insert(backgroundJobs).values({ organisationId: context.organisationId, queue: "calendar", type: "calendar_reconcile", deduplicationKey: `calendar-connect:${connection.id}`, payload: { connectionId: connection.id } }).onConflictDoNothing();
      await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "calendar.connected", resourceType: "calendar_connection", resourceId: connection.id, metadata: { provider: exchange.state.provider, accountEmail: exchange.accountEmail } });
      return connection;
    });
    const admin = createDatabase(process.env.DATABASE_ADMIN_URL);
    try { const webhook = await registerCalendarWebhook(exchange.state.provider, connection.id, String(exchange.tokens.access_token), url.origin); if (webhook) await admin.update(calendarConnections).set({ webhookChannelId: webhook.channelId, webhookExpiresAt: webhook.expiresAt, updatedAt: new Date() }).where(eq(calendarConnections.id, connection.id)); } catch (error) { await admin.update(calendarConnections).set({ lastError: (error as Error).message, updatedAt: new Date() }).where(eq(calendarConnections.id, connection.id)); }
    return Response.redirect(new URL("/account?section=connections&calendar=connected", url.origin));
  } catch { return Response.redirect(new URL("/?calendar=failed", url.origin)); }
}
