import {resolveWorkspace,workspaceHref} from "@/lib/workspace-mode";
import {workspaceAudit} from "@/lib/workspace-audit";
import {registerCalendarWebhookAttempt} from "@/lib/calendar-registration-attempt";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { auditEvents, backgroundJobs, calendarConnections, organisations, createDatabase, withTenant } from "@surveynt/db";
import { and, eq, sql } from "drizzle-orm";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
import { calendarEncryptionKeyVersion,exchangeCalendarCode,readCalendarState, encryptCalendarSecret } from "@/lib/calendar-oauth";

export const runtime="nodejs";
export const maxDuration=60;

export async function GET(request: Request) {
  const authenticated = await apiContext(request); const url = new URL(request.url); const stateValue = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (!authenticated?.internalUserId || !stateValue || !code) return Response.redirect(new URL("/?calendar=denied", url.origin));
  let context:NonNullable<typeof authenticated>=authenticated;const userId=authenticated.internalUserId;
  if (!canWriteWorkspace(context) || context.demo || await isDemoOrganisation(context.organisationId)) return Response.redirect(new URL("/account?calendar=denied", url.origin));
  let returnPath="/account?section=connections";
  try {
    const state=readCalendarState(stateValue);
    if(state.workspaceMode){const projection=resolveWorkspace(context.actorRole??context.role,state.workspaceMode);if(!projection)return Response.redirect(new URL("/?calendar=denied",url.origin));context={...context,role:projection.effectiveRole,actorRole:projection.actorRole,workspaceMode:projection.workspaceMode};const [practice]=await createDatabase().select({slug:organisations.slug}).from(organisations).where(eq(organisations.id,context.organisationId)).limit(1);if(practice)returnPath=workspaceHref(`/app/${practice.slug}/account?section=connections`,{slug:practice.slug,workspaceMode:state.workspaceMode,actorRole:context.actorRole});}
    const accessDenial=await workspaceApiGuard(request,context);if(accessDenial)return accessDenial;
    const exchange = await exchangeCalendarCode(stateValue,code,url.origin,{organisationId:context.organisationId,userId:userId});
    if (exchange.state.organisationId !== context.organisationId || exchange.state.userId !== userId) return Response.redirect(new URL("/?calendar=identity_mismatch", url.origin));
    const connection = await withTenant(createDatabase(), context.organisationId, async (tx) => {
      const [existing] = await tx.select().from(calendarConnections).where(and(eq(calendarConnections.organisationId,context.organisationId),eq(calendarConnections.provider,exchange.state.provider),eq(calendarConnections.providerAccountId,exchange.providerAccountId))).limit(1).for("update");
      if(existing && existing.userId !== userId) throw new Error("CALENDAR_ACCOUNT_ALREADY_CONNECTED");
      if(existing){
        const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${existing.id}`},0)) as acquired`);
        if(!(lock.rows[0] as {acquired:boolean}|undefined)?.acquired)throw new Error("CALENDAR_SYNC_IN_PROGRESS");
      }
      if(existing?.webhookChannelId){
        const encryptedCleanup=encryptCalendarSecret({connectionId:existing.id,organisationId:existing.organisationId,userId:existing.userId,provider:existing.provider,channelId:existing.webhookChannelId,resourceId:existing.webhookResourceId,tokens:exchange.tokens});
        await tx.insert(backgroundJobs).values({organisationId:existing.organisationId,queue:"calendar_subscription",type:"stop_webhook",deduplicationKey:`calendar-stop:${existing.id}:${existing.webhookChannelId}`,payload:{connectionId:existing.id,encryptedCleanup}}).onConflictDoUpdate({target:backgroundJobs.deduplicationKey,set:{status:"queued",payload:{connectionId:existing.id,encryptedCleanup},attempts:0,availableAt:new Date(),failedAt:null,completedAt:null,error:null,lockedUntil:null,leaseToken:null,updatedAt:new Date()},setWhere:sql`${backgroundJobs.status} in ('queued','failed')`});
      }
      const [connection] = await tx.insert(calendarConnections).values({ organisationId: context.organisationId, userId: userId!, provider: exchange.state.provider, providerAccountId: exchange.providerAccountId, encryptedCredentials: encryptCalendarSecret(exchange.tokens), encryptionKeyVersion:calendarEncryptionKeyVersion(), status: "active" }).onConflictDoUpdate({ target: [calendarConnections.organisationId, calendarConnections.provider, calendarConnections.providerAccountId], set: { encryptedCredentials: encryptCalendarSecret(exchange.tokens), encryptionKeyVersion:calendarEncryptionKeyVersion(), status: "active", webhookChannelId:null,webhookAttemptId:null,webhookResourceId:null,webhookExpiresAt:null,lastError: null, updatedAt: new Date() } }).returning();
      if(connection.userId !== userId) throw new Error("CALENDAR_ACCOUNT_ALREADY_CONNECTED");
      await tx.insert(backgroundJobs).values({ organisationId: context.organisationId, queue: "calendar", type: "calendar_reconcile", deduplicationKey: `calendar-connect:${connection.id}:${crypto.randomUUID()}`, payload: { connectionId: connection.id } }).onConflictDoNothing();
      await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: userId, action: "calendar.connected", resourceType: "calendar_connection", resourceId: connection.id, metadata: { provider: exchange.state.provider, accountEmail: exchange.accountEmail } }));
      const [pending]=await tx.select({id:backgroundJobs.id}).from(backgroundJobs).where(and(eq(backgroundJobs.organisationId,connection.organisationId),eq(backgroundJobs.queue,"calendar_subscription"),eq(backgroundJobs.type,"register_webhook"),sql`${backgroundJobs.payload}->>'connectionId' = ${connection.id}`,sql`${backgroundJobs.status} in ('queued','processing','failed')`)).limit(1);
      if(pending)await tx.update(calendarConnections).set({lastError:"An earlier calendar registration requires provider review before another subscription can be created."}).where(eq(calendarConnections.id,connection.id));
      return {row:connection,registrationBlocked:Boolean(pending)};
    });
    const admin = createDatabase(process.env.DATABASE_ADMIN_URL);
    try {
      if(connection.registrationBlocked)return Response.redirect(new URL(`${returnPath}&calendar=review_required`,url.origin));
      await registerCalendarWebhookAttempt(admin,connection.row,exchange.tokens,url.origin);
    }catch{
      await admin.update(calendarConnections).set({lastError:"Calendar webhook registration requires review.",updatedAt:new Date()}).where(and(eq(calendarConnections.id,connection.row.id),eq(calendarConnections.status,"active"),eq(calendarConnections.encryptedCredentials,connection.row.encryptedCredentials)));
    }

    return Response.redirect(new URL(`${returnPath}&calendar=connected`, url.origin));
  } catch { return Response.redirect(new URL(`${returnPath}&calendar=failed`, url.origin)); }
}
