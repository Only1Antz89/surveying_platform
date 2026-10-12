import {workspaceAudit} from "@/lib/workspace-audit";
import { changeAppointment } from "@/lib/appointment-change";
import { CalendarReviewError } from "@/lib/calendar-provider-review";
import { inspectCalendarConflict,restoreCalendarConflictTime } from "@/lib/calendar-sync";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { appointments, auditEvents, calendarConflicts,calendarConnections,calendarEventLinks, createDatabase, withTenant } from "@surveynt/db";
import { canManageTeam } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

export async function POST(request: Request, route: RouteContext<"/api/v1/calendar/conflicts/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to review conflicts.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context) || !canManageTeam(context.role)) return problem(403, "forbidden", "Only owners and administrators can resolve calendar conflicts.");
  const parsed = await parseBody(request, z.object({ decision: z.enum(["keep_surveynt","accept_external"]), expectedUpdatedAt:z.iso.datetime(),expectedAppointmentVersion:z.number().int().positive(),expectedExternalVersion:z.string().nullable() }));
  if (!parsed.success) return problem(400, "invalid_request", "Reload the calendar and review the current conflict before deciding.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(400, "invalid_id", "Choose a conflict.");
  if(context.demo)return problem(409,"preview_only","Use an authenticated practice to persist calendar decisions.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organisationId}:scheduling`}))`);
    const [conflict] = await tx.select().from(calendarConflicts).where(and(eq(calendarConflicts.id, id), eq(calendarConflicts.organisationId, context.organisationId))).for("update");
    if (!conflict) return problem(404, "not_found", "Conflict not found.");
    if (conflict.status !== "open") return problem(409, "already_resolved", "This conflict has already been reviewed.");
    if(conflict.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt||conflict.details.appointmentVersion!==parsed.data.expectedAppointmentVersion||conflict.details.externalVersion!==parsed.data.expectedExternalVersion)return problem(409,"stale_conflict","The calendar conflict changed. Reload and review the latest times.");
    const [appointment]=conflict.appointmentId?await tx.select().from(appointments).where(and(eq(appointments.id,conflict.appointmentId),eq(appointments.organisationId,context.organisationId))).for("update").limit(1):[];
    if(!appointment||appointment.version!==parsed.data.expectedAppointmentVersion||appointment.status==="cancelled"||appointment.status==="completed")return problem(409,"stale_appointment","The appointment changed. Synchronise and review it before resolving the conflict.");
    const locked=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`calendar-sync:${conflict.connectionId}`},0)) as acquired`);
    if(!(locked.rows[0] as {acquired:boolean}|undefined)?.acquired)return problem(409,"sync_in_progress","The calendar is synchronising. Reload after it finishes.");
    const [connection]=await tx.select().from(calendarConnections).where(and(eq(calendarConnections.id,conflict.connectionId),eq(calendarConnections.organisationId,context.organisationId),eq(calendarConnections.userId,appointment.surveyorId!),eq(calendarConnections.status,"active"))).limit(1);
    const [link]=await tx.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.connectionId,conflict.connectionId),eq(calendarEventLinks.organisationId,context.organisationId),eq(calendarEventLinks.appointmentId,appointment.id))).for("update").limit(1);
    if(!connection||!link)return problem(409,"connection_changed","The active calendar link is unavailable. Synchronise and review it again.");
    if(conflict.details.externalEventId!==link.externalEventId)return problem(409,"link_changed","The calendar event link changed. Synchronise and review it again.");
    if(parsed.data.decision==="accept_external"){
      if(!["external_time_changed","external_cancelled"].includes(conflict.kind))return problem(409,"unsupported_conflict","This conflict needs a separate review.");
      let external;
      try{external=await inspectCalendarConflict(connection,appointment,link.externalEventId,parsed.data.expectedExternalVersion,{cancelled:conflict.kind==="external_cancelled",start:typeof conflict.details.externalStart==="string"?conflict.details.externalStart:null,end:typeof conflict.details.externalEnd==="string"?conflict.details.externalEnd:null});}catch(error){return problem(error instanceof CalendarReviewError?error.status:502,"calendar_resolution_failed",error instanceof CalendarReviewError?error.message:"The provider snapshot could not be confirmed. The conflict remains open.");}
      const start=external.cancelled?appointment.startsAt:external.start,end=external.cancelled?appointment.endsAt:external.end;
      if(!start||!end||!appointment.surveyorId)return problem(409,"invalid_external_visit","The reviewed visit needs valid times and a surveying member.");
      const duration=(end.getTime()-start.getTime())/60000;
      if(!Number.isInteger(duration)||duration<15||duration>480)return problem(409,"invalid_external_visit","The reviewed visit duration must be between 15 and 480 whole minutes.");
      const result=await changeAppointment(tx,context,{id:appointment.id,version:appointment.version,jobId:appointment.jobId,surveyorId:appointment.surveyorId,startsAt:start.toISOString(),durationMinutes:duration,cancel:external.cancelled});
      if(!result.ok)return result;
      await tx.update(calendarEventLinks).set({externalVersion:external.version,lastSyncedAppointmentVersion:appointment.version+1,updatedAt:new Date()}).where(eq(calendarEventLinks.id,link.id));
      await tx.update(calendarConflicts).set({status:"resolved",resolvedAt:new Date(),resolvedByUserId:context.internalUserId,updatedAt:new Date()}).where(eq(calendarConflicts.id,id));
      await tx.insert(auditEvents).values(workspaceAudit(context,{organisationId:context.organisationId,actorUserId:context.internalUserId,action:"calendar.conflict_resolved",resourceType:"calendar_conflict",resourceId:id,metadata:{decision:"accept_external",appointmentVersion:appointment.version+1,reviewedUpdatedAt:parsed.data.expectedUpdatedAt,providerEventId:external.id,providerVersion:external.version,cancelled:external.cancelled,externalCalendarChanged:false,simulated:external.simulated}}));
      return ok({resolved:true,externalCalendarChanged:false,localCalendarChanged:true,cancelled:external.cancelled,simulated:external.simulated});
    }
    let provider;
    try{provider=await restoreCalendarConflictTime(connection,appointment,link.externalEventId,parsed.data.expectedExternalVersion,{id:conflict.id,kind:conflict.kind});}catch(error){return problem(error instanceof CalendarReviewError?error.status:502,"calendar_resolution_failed",error instanceof CalendarReviewError?error.message:"The provider update could not be confirmed. The conflict remains open.");}
    await tx.update(calendarEventLinks).set({externalEventId:provider.id,externalVersion:provider.version,lastSyncedAppointmentVersion:appointment.version,updatedAt:new Date()}).where(eq(calendarEventLinks.id,link.id));
    await tx.update(calendarConflicts).set({ status: "resolved", resolvedAt: new Date(), resolvedByUserId: context.internalUserId, updatedAt: new Date() }).where(eq(calendarConflicts.id, id));
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "calendar.conflict_resolved", resourceType: "calendar_conflict", resourceId: id, metadata: { decision: parsed.data.decision,appointmentVersion:appointment.version,externalVersion:parsed.data.expectedExternalVersion,reviewedUpdatedAt:parsed.data.expectedUpdatedAt,providerEventId:provider.id,previousEventId:link.externalEventId,providerVersion:provider.version,externalCalendarChanged:provider.changed,simulated:provider.simulated } }));
    return ok({ resolved: true, externalCalendarChanged: provider.changed,simulated:provider.simulated });
  });
}
