import { and,asc,eq,gt,inArray,lt,ne,or,sql } from "drizzle-orm";
import { appointments,auditEvents,availabilityBlocks,jobs,jobStageEvents,memberWorkProfiles,organisationMemberships,organisationOperationalSettings,type TenantTransaction } from "@surveynt/db";
import type { apiContext } from "./access";
import { ok,problem } from "./api";
import { withinWorkingHours } from "./booking-slots";
import { localParts } from "./scheduling";
type Context=NonNullable<Awaited<ReturnType<typeof apiContext>>>;
export type AppointmentChange={id?:string;version?:number;jobId:string;surveyorId:string;startsAt:string;durationMinutes:number;cancel?:boolean};
/** Caller owns the practice scheduling lock; this applies identical visit/job checks. */
export async function changeAppointment(tx:TenantTransaction,c:Context,v:AppointmentChange){
    const [job]=await tx.select().from(jobs).where(and(eq(jobs.id,v.jobId),eq(jobs.organisationId,c.organisationId))).for("update").limit(1);
    const [member]=await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,c.organisationId),eq(organisationMemberships.userId,v.surveyorId),eq(organisationMemberships.active,true))).limit(1);
    if(!job||!member||!["owner","administrator","manager","surveyor"].includes(member.role))return problem(404,"not_found","Choose a job and active surveying member of this practice.");
    if(c.role==="surveyor"&&(job.assignedSurveyorId!==c.internalUserId||v.surveyorId!==c.internalUserId))return problem(403,"forbidden","Surveyors may manage only their assigned visits.");
    const [old]=v.id?await tx.select().from(appointments).where(and(eq(appointments.id,v.id),eq(appointments.organisationId,c.organisationId))).for("update").limit(1):[];
    if(v.id&&(!old||old.version!==v.version||old.jobId!==v.jobId))return problem(409,"appointment_changed","Reload this appointment before updating it.");
    if (v.cancel && old?.status === "completed") return problem(409, "visit_completed", "A completed inspection cannot be cancelled. Review the job history instead.");
    const start=new Date(v.startsAt),end=new Date(start.getTime()+v.durationMinutes*60000);
    const [settings]=await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,c.organisationId)).limit(1);
    const [personal]=await tx.select().from(memberWorkProfiles).where(and(eq(memberWorkProfiles.organisationId,c.organisationId),eq(memberWorkProfiles.userId,v.surveyorId))).limit(1);
    if(!v.cancel){
      if(!settings||!withinWorkingHours(start,end,settings))return problem(409,"outside_hours","This time is outside practice hours or a closure.");
      const personalDay=personal?localParts(start,personal.timezone).weekday:null;
      const personalHours=personalDay?personal?.workingHours[personalDay]:undefined;
      if(personalHours?.closed)return problem(409,"personal_day_off","The surveyor is unavailable on this day.");
      if(personalHours&&!withinWorkingHours(start,end,{...settings,timezone:personal!.timezone,workingDays:[personalDay!],workingHours:{[personalDay!]:personalHours},holidayDates:[]}))return problem(409,"outside_personal_hours","This time is outside the surveyor’s working hours.");
      const buffer=settings.travelBufferMinutes*60000;
      const [busy,blocked]=await Promise.all([
        tx.select({id:appointments.id}).from(appointments).where(and(eq(appointments.organisationId,c.organisationId),ne(appointments.status,"cancelled"),v.id?ne(appointments.id,v.id):undefined,or(eq(appointments.surveyorId,v.surveyorId),sql`${appointments.surveyorId} is null`),lt(appointments.startsAt,new Date(end.getTime()+buffer)),gt(appointments.endsAt,new Date(start.getTime()-buffer)))).limit(1),
        tx.select({id:availabilityBlocks.id}).from(availabilityBlocks).where(and(eq(availabilityBlocks.organisationId,c.organisationId),or(eq(availabilityBlocks.userId,v.surveyorId),sql`${availabilityBlocks.userId} is null`),lt(availabilityBlocks.startsAt,new Date(end.getTime()+buffer)),gt(availabilityBlocks.endsAt,new Date(start.getTime()-buffer)))).limit(1)
      ]);if(busy.length||blocked.length)return problem(409,"slot_unavailable","This slot is occupied, blocked or inside a travel buffer.");
    }else if(!old)return problem(400,"appointment_required","Choose an existing appointment to cancel.");
    const values={startsAt:start,endsAt:end,surveyorId:v.surveyorId,status:v.cancel?"cancelled" as const:"confirmed" as const,timezone:settings?.timezone??"Europe/London",updatedAt:new Date()};
    const [record]=old?await tx.update(appointments).set({...values,version:old.version+1}).where(and(eq(appointments.id,old.id),eq(appointments.organisationId,c.organisationId))).returning():await tx.insert(appointments).values({organisationId:c.organisationId,jobId:v.jobId,...values}).returning();
    if(!v.cancel){
      const stage=job.stage==="instructed"?"scheduled" as const:job.stage;
      const targetDate=new Intl.DateTimeFormat("en-CA",{timeZone:values.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(start);
      await tx.update(jobs).set({assignedSurveyorId:v.surveyorId,targetDate,stage,version:job.version+1,updatedAt:new Date()}).where(eq(jobs.id,job.id));
      if(stage!==job.stage)await tx.insert(jobStageEvents).values({organisationId:c.organisationId,jobId:job.id,fromStage:job.stage,toStage:stage,changedByUserId:c.internalUserId,reason:"Appointment confirmed"});
      await tx.insert(auditEvents).values({organisationId:c.organisationId,actorUserId:c.internalUserId,action:"job.appointment_linked",resourceType:"job",resourceId:job.id,metadata:{appointmentId:record.id,targetDate,surveyorId:v.surveyorId}});
    }
    if(v.cancel && job.stage === "scheduled") {
      const [nextVisit] = await tx.select().from(appointments).where(and(eq(appointments.organisationId, c.organisationId), eq(appointments.jobId, job.id), inArray(appointments.status, ["provisional", "confirmed", "conflict"]))).orderBy(asc(appointments.startsAt)).limit(1);
      const stage = nextVisit ? "scheduled" as const : "instructed" as const;
      const targetDate = nextVisit ? localParts(nextVisit.startsAt, nextVisit.timezone).date : null;
      await tx.update(jobs).set({ stage, targetDate, version: job.version + 1, updatedAt: new Date() }).where(and(eq(jobs.id, job.id), eq(jobs.organisationId, c.organisationId)));
      if(stage !== job.stage) await tx.insert(jobStageEvents).values({ organisationId: c.organisationId, jobId: job.id, fromStage: job.stage, toStage: stage, changedByUserId: c.internalUserId, reason: "Final appointment cancelled; inspection requires scheduling" });
      await tx.insert(auditEvents).values({ organisationId: c.organisationId, actorUserId: c.internalUserId, action: "job.appointment_cancelled", resourceType: "job", resourceId: job.id, metadata: { appointmentId: record.id, remainingAppointmentId: nextVisit?.id ?? null, fromStage: job.stage, toStage: stage, targetDate } });
    }
    await tx.insert(auditEvents).values({organisationId:c.organisationId,actorUserId:c.internalUserId,action:v.cancel?"appointment.cancelled":old?"appointment.rescheduled":"appointment.created",resourceType:"appointment",resourceId:record.id,metadata:{startsAt:record.startsAt.toISOString(),surveyorId:record.surveyorId,version:record.version}});return ok(record);
}
