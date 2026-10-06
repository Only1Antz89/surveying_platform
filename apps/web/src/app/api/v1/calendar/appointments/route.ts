import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and,asc,eq,gt,inArray,lt,ne,or,sql } from "drizzle-orm";
import { appointments,auditEvents,availabilityBlocks,createDatabase,jobs,jobStageEvents,memberWorkProfiles,organisationMemberships,organisationOperationalSettings,properties,users,withTenant } from "@surveynt/db";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext,canWriteWorkspace } from "@/lib/access";
import { ok,parseBody,problem } from "@/lib/api";
import { withinWorkingHours } from "@/lib/booking-slots";
import { localParts } from "@/lib/scheduling";
const input=z.object({id:z.uuid().optional(),version:z.number().int().positive().optional(),jobId:z.uuid(),surveyorId:z.uuid(),startsAt:z.iso.datetime(),durationMinutes:z.number().int().min(15).max(480),cancel:z.boolean().optional()});
export async function GET(request:Request){
  const c=await apiContext(request);if(!c)return problem(401,"unauthorised","Sign in to view appointments.");const accessDenial=await workspaceApiGuard(request,c);if(accessDenial)return accessDenial;if(c.demo)return ok({appointments:[],jobs:[],members:[]});
  const url=new URL(request.url);const range=z.object({from:z.iso.datetime(),to:z.iso.datetime()}).safeParse({from:url.searchParams.get("from")??new Date(Date.now()-31*86400000).toISOString(),to:url.searchParams.get("to")??new Date(Date.now()+62*86400000).toISOString()});if(!range.success||new Date(range.data.to).getTime()-new Date(range.data.from).getTime()>93*86400000||range.data.from>=range.data.to)return problem(400,"invalid_range","Choose a date range of up to 93 days.");
  return withTenant(createDatabase(),c.organisationId,async tx=>{const [rows,work,members]=await Promise.all([
    tx.select({appointment:appointments,reference:jobs.reference,address:properties.line1}).from(appointments).innerJoin(jobs,and(eq(jobs.id,appointments.jobId),eq(jobs.organisationId,c.organisationId))).innerJoin(properties,and(eq(properties.id,jobs.propertyId),eq(properties.organisationId,c.organisationId))).where(and(eq(appointments.organisationId,c.organisationId),gt(appointments.endsAt,new Date(range.data.from)),lt(appointments.startsAt,new Date(range.data.to)),c.role==="surveyor"?and(eq(appointments.surveyorId,c.internalUserId!),eq(jobs.assignedSurveyorId,c.internalUserId!)):undefined)).orderBy(asc(appointments.startsAt)).limit(500),
    tx.select({id:jobs.id,reference:jobs.reference}).from(jobs).where(and(eq(jobs.organisationId,c.organisationId),c.role==="surveyor"?eq(jobs.assignedSurveyorId,c.internalUserId!):undefined)).limit(200),
    tx.select({id:users.id,name:users.firstName,lastName:users.lastName,role:organisationMemberships.role}).from(organisationMemberships).innerJoin(users,eq(users.id,organisationMemberships.userId)).where(and(eq(organisationMemberships.organisationId,c.organisationId),eq(organisationMemberships.active,true),inArray(organisationMemberships.role,["owner","administrator","manager","surveyor"]),c.role==="surveyor"?eq(organisationMemberships.userId,c.internalUserId!):undefined)),
  ]);return ok({appointments:rows.map(r=>({...r.appointment,reference:r.reference,address:r.address})),jobs:work,members});});
}
export async function POST(request:Request){
  const c=await apiContext(request);if(!c)return problem(401,"unauthorised","Sign in to manage appointments.");const accessDenial=await workspaceApiGuard(request,c);if(accessDenial)return accessDenial;if(!canWriteWorkspace(c)||!canMutateOperations(c.role))return problem(403,"forbidden","Your role cannot manage appointments.");const p=await parseBody(request,input);if(!p.success)return problem(400,"invalid_request","Check the appointment fields.");if(c.demo)return problem(409,"preview_only","Use the authenticated stakeholder demo for persistent scheduling.");const v=p.data;
  return withTenant(createDatabase(),c.organisationId,async tx=>{
    // One practice scheduling lock covers rescheduling across days and concurrent staff/customer claims.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${c.organisationId}:scheduling`}))`);
    const [job]=await tx.select().from(jobs).where(and(eq(jobs.id,v.jobId),eq(jobs.organisationId,c.organisationId))).for("update").limit(1);
    const [member]=await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,c.organisationId),eq(organisationMemberships.userId,v.surveyorId),eq(organisationMemberships.active,true))).limit(1);
    if(!job||!member||!["owner","administrator","manager","surveyor"].includes(member.role))return problem(404,"not_found","Choose a job and active surveying member of this practice.");
    if(c.role==="surveyor"&&(job.assignedSurveyorId!==c.internalUserId||v.surveyorId!==c.internalUserId))return problem(403,"forbidden","Surveyors may manage only their assigned visits.");
    const [old]=v.id?await tx.select().from(appointments).where(and(eq(appointments.id,v.id),eq(appointments.organisationId,c.organisationId))).for("update").limit(1):[];
    if(v.id&&(!old||old.version!==v.version||old.jobId!==v.jobId))return problem(409,"appointment_changed","Reload this appointment before updating it.");
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
    await tx.insert(auditEvents).values({organisationId:c.organisationId,actorUserId:c.internalUserId,action:v.cancel?"appointment.cancelled":old?"appointment.rescheduled":"appointment.created",resourceType:"appointment",resourceId:record.id,metadata:{startsAt:record.startsAt.toISOString(),surveyorId:record.surveyorId,version:record.version}});return ok(record);
  });
}
