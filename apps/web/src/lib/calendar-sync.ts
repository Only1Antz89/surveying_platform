import { CalendarReviewError, readReviewedExternalEvent, replaceCancelledExternalEvent, restoreExternalTime } from "./calendar-provider-review";
import { randomUUID } from "node:crypto";
import { finishCalendarAttempt, recoverCalendarLeases } from "./calendar-queue";
import { createExternalEvent } from "./calendar-export";
import { hasExternalCalendarConflict } from "./calendar-conflict";
import { externalEvents } from "./calendar-events";
import { and, asc, eq, gt, inArray, lte, or, sql, isNull, notInArray } from "drizzle-orm";
import { auditEvents, appointments, availabilityBlocks, backgroundJobs, calendarConflicts, calendarConnections, calendarEventLinks, createDatabase } from "@surveynt/db";
import { calendarEncryptionKeyVersion,calendarSecretUsesActiveKey,decryptCalendarSecret, encryptCalendarSecret } from "./calendar-oauth";
import { isDemoOrganisation } from "./stakeholder-demo";

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; obtained_at?: number; token_type?: string; scope?: string };

async function saveCalendarTokens(connection:typeof calendarConnections.$inferSelect,tokens:Tokens,rotation=false){
  const ciphertext=encryptCalendarSecret(tokens),version=calendarEncryptionKeyVersion();
  await createDatabase(process.env.DATABASE_ADMIN_URL).transaction(async tx=>{
    const saved=await tx.update(calendarConnections).set({encryptedCredentials:ciphertext,encryptionKeyVersion:version,updatedAt:new Date()}).where(and(eq(calendarConnections.id,connection.id),eq(calendarConnections.organisationId,connection.organisationId),eq(calendarConnections.userId,connection.userId),eq(calendarConnections.status,"active"),eq(calendarConnections.encryptedCredentials,connection.encryptedCredentials))).returning({id:calendarConnections.id});
    if(!saved.length)throw new CalendarReviewError("The calendar connection changed during refresh. Reconnect or retry after synchronisation.");
    if(rotation)await tx.insert(auditEvents).values({organisationId:connection.organisationId,action:"calendar.credentials_reencrypted",resourceType:"calendar_connection",resourceId:connection.id,metadata:{previousKeyVersion:connection.encryptionKeyVersion,keyVersion:version,source:"calendar_reconciliation"}});
  });
}

async function validTokens(connection: typeof calendarConnections.$inferSelect) {
  let tokens = decryptCalendarSecret<Tokens>(connection.encryptedCredentials);
  if (!tokens.refresh_token || !tokens.expires_in || !tokens.obtained_at || tokens.obtained_at + tokens.expires_in * 1000 > Date.now() + 60_000){
    if(!calendarSecretUsesActiveKey(connection.encryptedCredentials))await saveCalendarTokens(connection,tokens,true);
    return tokens;
  }
  const google = connection.provider === "google"; const body = new URLSearchParams({ client_id: google ? process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "" : process.env.MICROSOFT_CALENDAR_CLIENT_ID ?? "", client_secret: google ? process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "" : process.env.MICROSOFT_CALENDAR_CLIENT_SECRET ?? "", grant_type: "refresh_token", refresh_token: tokens.refresh_token }); if (!google) body.set("scope", "openid email offline_access User.Read Calendars.ReadWrite");
  const response = await fetch(google ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST", redirect:"error", signal:AbortSignal.timeout(15000), headers: { "content-type": "application/x-www-form-urlencoded" }, body }); const refreshed = await response.json() as Partial<Tokens>;
  if (!response.ok || !refreshed.access_token) throw new Error("Calendar access could not be refreshed."); tokens = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token ?? tokens.refresh_token, obtained_at: Date.now() };
  await saveCalendarTokens(connection,tokens,connection.encryptionKeyVersion!==calendarEncryptionKeyVersion());
  return tokens;
}



/** Caller holds the connection advisory lock and the reviewed appointment row. */
export async function restoreCalendarConflictTime(connection:typeof calendarConnections.$inferSelect,appointment:typeof appointments.$inferSelect,eventId:string,reviewedVersion:string|null,conflict?:{id:string;kind:string}){
  if(connection.provider!=="google"&&connection.provider!=="microsoft")throw new Error("Unsupported calendar provider.");
  if(await isDemoOrganisation(connection.organisationId,createDatabase(process.env.DATABASE_ADMIN_URL)))return {id:eventId,version:reviewedVersion,changed:false,simulated:true};
  const tokens=await validTokens(connection);
  if(conflict?.kind==="external_cancelled")return {...await replaceCancelledExternalEvent(connection.provider,tokens.access_token,appointment,eventId,reviewedVersion,connection.id,conflict.id),simulated:false};
  return {id:eventId,...await restoreExternalTime(connection.provider,tokens.access_token,appointment,eventId,reviewedVersion),simulated:false};
}

/** Caller holds the connection advisory lock and reviewed appointment row. */
export async function inspectCalendarConflict(connection:typeof calendarConnections.$inferSelect,appointment:typeof appointments.$inferSelect,eventId:string,reviewedVersion:string|null,reviewed:{cancelled:boolean;start:string|null;end:string|null}){
  if(connection.provider!=="google"&&connection.provider!=="microsoft")throw new Error("Unsupported calendar provider.");
  if(await isDemoOrganisation(connection.organisationId,createDatabase(process.env.DATABASE_ADMIN_URL)))return {id:eventId,version:reviewedVersion,cancelled:reviewed.cancelled,start:reviewed.start?new Date(reviewed.start):null,end:reviewed.end?new Date(reviewed.end):null,simulated:true};
  const tokens=await validTokens(connection);
  return {...await readReviewedExternalEvent(connection.provider,tokens.access_token,appointment.id,eventId,reviewedVersion,reviewed),simulated:false};
}

export async function reconcileCalendarConnection(connectionId: string) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required.");
  const lockDb = createDatabase(process.env.DATABASE_ADMIN_URL);
  // The transaction owns the lock; crashes and failed syncs release it automatically.
  // Provider side effects and refreshed credentials retain their own recovery records.
  return lockDb.transaction(async tx => {
    const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${connectionId}`}, 0)) as acquired`);
    const lock = result.rows[0] as {acquired:boolean}|undefined;
    if (!lock?.acquired) throw new Error("Calendar connection is already synchronising. Retry later.");
    return reconcileCalendarConnectionUnlocked(connectionId);
  });
}

async function reconcileCalendarConnectionUnlocked(connectionId: string) {
  const exportDeadline=Date.now()+40000;
  if (process.env.DATABASE_ADMIN_URL) {
    const demoDb=createDatabase(process.env.DATABASE_ADMIN_URL);
    const [record]=await demoDb.select({organisationId:calendarConnections.organisationId}).from(calendarConnections).where(eq(calendarConnections.id,connectionId)).limit(1);
    if(record&&await isDemoOrganisation(record.organisationId,demoDb))return {importedBusy:0,exported:0,updated:0,simulated:true};
  }
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required."); const db = createDatabase(process.env.DATABASE_ADMIN_URL); const [connection] = await db.select().from(calendarConnections).where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.status, "active"))).limit(1); if (!connection || (connection.provider !== "google" && connection.provider !== "microsoft")) throw new Error("Active calendar connection not found."); const tokens = await validTokens(connection); const remote = await externalEvents(connection.provider, tokens.access_token); const links = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.connectionId, connection.id),eq(calendarEventLinks.organisationId,connection.organisationId))); const linkByExternal = new Map(links.map((link) => [link.externalEventId, link])); const linkedAppointmentIds = links.map((link) => link.appointmentId); const linkedAppointments = linkedAppointmentIds.length ? await db.select().from(appointments).where(and(inArray(appointments.id, linkedAppointmentIds),eq(appointments.organisationId,connection.organisationId),eq(appointments.surveyorId,connection.userId))) : []; const appointmentById = new Map(linkedAppointments.map((item) => [item.id, item]));
  await db.transaction(async (tx) => { const source = `calendar:${connection.id}`; await tx.delete(availabilityBlocks).where(and(eq(availabilityBlocks.organisationId, connection.organisationId), eq(availabilityBlocks.source, source))); const busy = remote.filter((event) => !event.cancelled && !event.surveyntAppointmentId); if (busy.length) await tx.insert(availabilityBlocks).values(busy.map((event) => ({ organisationId: connection.organisationId, userId: connection.userId, startsAt: event.start!, endsAt: event.end!, kind: "external_busy", source, externalEventId: event.id })));
    for (const event of remote) {
      const link = linkByExternal.get(event.id),appointment=link?appointmentById.get(link.appointmentId):null;
      if(!link||!appointment)continue;
      const changed=hasExternalCalendarConflict(event,appointment,link);
      const [existing]=await tx.select().from(calendarConflicts).where(and(eq(calendarConflicts.organisationId,connection.organisationId),eq(calendarConflicts.connectionId,connection.id),eq(calendarConflicts.appointmentId,appointment.id),eq(calendarConflicts.status,"open"))).for("update").limit(1);
      const kind=event.cancelled?"external_cancelled":"external_time_changed";
      const details={externalEventId:event.id,externalVersion:event.version,appointmentVersion:appointment.version,externalStart:event.start?.toISOString()??null,externalEnd:event.end?.toISOString()??null,surveyntStart:appointment.startsAt.toISOString(),surveyntEnd:appointment.endsAt.toISOString()};
      const converged=!event.cancelled&&!!event.start&&!!event.end&&Math.abs(event.start.getTime()-appointment.startsAt.getTime())<=1000&&Math.abs(event.end.getTime()-appointment.endsAt.getTime())<=1000;
      if(existing&&converged){
        await tx.update(calendarConflicts).set({status:"resolved",details,resolvedAt:new Date(),resolvedByUserId:null,updatedAt:new Date()}).where(eq(calendarConflicts.id,existing.id));
        await tx.insert(auditEvents).values({organisationId:connection.organisationId,action:"calendar.conflict_converged",resourceType:"calendar_conflict",resourceId:existing.id,metadata:{externalEventId:event.id,externalVersion:event.version,appointmentVersion:appointment.version}});
      }else if(existing){
        if(existing.kind!==kind||Object.entries(details).some(([key,value])=>existing.details[key]!==value))await tx.update(calendarConflicts).set({kind,details,updatedAt:new Date()}).where(eq(calendarConflicts.id,existing.id));
      }else if(changed){
        await tx.insert(calendarConflicts).values({organisationId:connection.organisationId,appointmentId:appointment.id,connectionId:connection.id,kind,details});
      }
    }

  });
  const unresolved = await db.select({ appointmentId: calendarConflicts.appointmentId }).from(calendarConflicts).where(and(eq(calendarConflicts.connectionId, connection.id), eq(calendarConflicts.status, "open")));
  const heldAppointments = new Set(unresolved.map(conflict => conflict.appointmentId));
  const heldIds=[...heldAppointments].filter((id):id is string=>id!==null);
  // Select work that still needs exporting, so early synced visits cannot hide later visits.
  const pendingExports=()=>db.select({appointment:appointments}).from(appointments).leftJoin(calendarEventLinks,and(eq(calendarEventLinks.appointmentId,appointments.id),eq(calendarEventLinks.connectionId,connection.id),eq(calendarEventLinks.organisationId,connection.organisationId))).where(and(eq(appointments.organisationId,connection.organisationId),eq(appointments.surveyorId,connection.userId),neCancelled(),gt(appointments.endsAt,new Date()),or(isNull(calendarEventLinks.id),gt(appointments.version,calendarEventLinks.lastSyncedAppointmentVersion)),heldIds.length?notInArray(appointments.id,heldIds):undefined)).orderBy(asc(appointments.startsAt),asc(appointments.id));
  const toExport=await pendingExports().limit(250);
  const linkByAppointment = new Map(links.map((item) => [item.appointmentId, item])); let exported = 0; let updated = 0;
  for (const {appointment} of toExport) {
    if(Date.now()>=exportDeadline)break;
    const link = linkByAppointment.get(appointment.id);
    if (!link) {
      const external = await createExternalEvent(connection.provider, tokens.access_token, appointment, connection.id);
      await db.insert(calendarEventLinks).values({ organisationId: connection.organisationId, connectionId: connection.id, appointmentId: appointment.id, externalEventId: external.id, externalVersion: external.version, lastSyncedAppointmentVersion: appointment.version });exported += 1;
    } else {
      try {
        const confirmed=await restoreExternalTime(connection.provider,tokens.access_token,appointment,link.externalEventId,link.externalVersion);
        await db.update(calendarEventLinks).set({externalVersion:confirmed.version,lastSyncedAppointmentVersion:appointment.version,updatedAt:new Date()}).where(eq(calendarEventLinks.id,link.id));updated++;
      }catch(error){
        if(!(error instanceof CalendarReviewError)||error.status!==409)throw error;
        // A fresh read or conditional update disagreed with the reconciliation
        // snapshot. Keep the old link revision and hold subsequent exports.
        const snapshot=remote.find(event=>event.id===link.externalEventId);
        await db.transaction(async tx=>{
          const [existing]=await tx.select().from(calendarConflicts).where(and(eq(calendarConflicts.connectionId,connection.id),eq(calendarConflicts.appointmentId,appointment.id),eq(calendarConflicts.status,"open"))).limit(1);
          if(existing)return;
          const [conflict]=await tx.insert(calendarConflicts).values({organisationId:connection.organisationId,connectionId:connection.id,appointmentId:appointment.id,kind:"export_review_required",details:{externalEventId:link.externalEventId,externalVersion:snapshot?.version??link.externalVersion,appointmentVersion:appointment.version,externalStart:snapshot?.start?.toISOString()??null,externalEnd:snapshot?.end?.toISOString()??null,surveyntStart:appointment.startsAt.toISOString(),surveyntEnd:appointment.endsAt.toISOString(),reason:error.message}}).returning();
          await tx.insert(auditEvents).values({organisationId:connection.organisationId,action:"calendar.export_review_required",resourceType:"calendar_conflict",resourceId:conflict.id,metadata:{appointmentId:appointment.id,externalEventId:link.externalEventId,lastSyncedAppointmentVersion:link.lastSyncedAppointmentVersion}});
        });
        heldIds.push(appointment.id);
      }
    }
  }
  const continuationRequired=(await pendingExports().limit(1)).length>0;
  await db.update(calendarConnections).set({ ...(continuationRequired?{}:{lastSyncedAt:new Date()}), lastError: null, updatedAt: new Date() }).where(eq(calendarConnections.id, connection.id));
  return { importedBusy: remote.filter((item) => !item.cancelled && !item.surveyntAppointmentId).length, exported, updated,continuationRequired };

}

function neCancelled() { return or(eq(appointments.status, "provisional"), eq(appointments.status, "confirmed"), eq(appointments.status, "conflict"))!; }
export async function processCalendarQueue(limit = 10) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL),started=Date.now();
  const recovered=await recoverCalendarLeases(db);
  const candidates = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue, "calendar"), eq(backgroundJobs.status, "queued"), lte(backgroundJobs.availableAt, new Date()))).orderBy(asc(backgroundJobs.availableAt)).limit(Math.max(0,Math.min(50,Math.floor(limit))));
  const results = [];
  for (const candidate of candidates) {
    if(Date.now()-started>=40000)break;
    const token=randomUUID();
    const [job] = await db.update(backgroundJobs).set({ status: "processing", attempts: candidate.attempts + 1, leaseToken:token,lockedUntil:new Date(Date.now()+300000),updatedAt: new Date() }).where(and(eq(backgroundJobs.id, candidate.id),eq(backgroundJobs.attempts,candidate.attempts), eq(backgroundJobs.status, "queued"))).returning();
    if (!job) continue;
    try {
      if(typeof job.payload.connectionId!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.payload.connectionId))throw new Error("Calendar job has no valid connection identity.");
      const [connection]=await db.select({organisationId:calendarConnections.organisationId}).from(calendarConnections).where(eq(calendarConnections.id,job.payload.connectionId)).limit(1);
      if(!connection||connection.organisationId!==job.organisationId)throw new Error("Calendar job does not belong to the connection's practice.");
      const result = await reconcileCalendarConnection(job.payload.connectionId);
      const persisted=await finishCalendarAttempt(db,job.id,token,"continuationRequired" in result&&result.continuationRequired?{status:"queued",attempts:0,availableAt:new Date(),completedAt:null,failedAt:null,error:null}:{status:"completed",completedAt:new Date(),failedAt:null,error:null});
      results.push({ id: job.id, ok: persisted, ...result });
    } catch (error) {
      const exhausted = job.attempts >= 5;
      await finishCalendarAttempt(db,job.id,token,exhausted?{status:"failed",failedAt:new Date(),error:(error as Error).message}:{status:"queued",availableAt:new Date(Date.now()+Math.min(2**job.attempts,60)*60000),error:(error as Error).message});
      results.push({ id: job.id, ok: false });
    }
  }
  return { claimed: results.length,recovered, results };
}

export async function enqueueCalendarReconciliation(now = new Date()) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required."); const db = createDatabase(process.env.DATABASE_ADMIN_URL); const rows = await db.select({ id: calendarConnections.id, organisationId: calendarConnections.organisationId }).from(calendarConnections).where(eq(calendarConnections.status, "active")); const day = now.toISOString().slice(0, 10); let queued = 0; for (const connection of rows) { const [job] = await db.insert(backgroundJobs).values({ organisationId: connection.organisationId, queue: "calendar", type: "calendar_reconcile", deduplicationKey: `calendar-reconcile:${connection.id}:${day}`, payload: { connectionId: connection.id } }).onConflictDoNothing().returning({ id: backgroundJobs.id }); if (job) queued += 1; } return { eligible: rows.length, queued };
}
