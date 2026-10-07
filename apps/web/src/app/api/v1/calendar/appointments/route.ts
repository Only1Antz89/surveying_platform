import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and,asc,eq,gt,inArray,lt,sql } from "drizzle-orm";
import { appointments,createDatabase,jobs,organisationMemberships,properties,users,withTenant } from "@surveynt/db";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext,canWriteWorkspace } from "@/lib/access";
import { ok,parseBody,problem } from "@/lib/api";
import { changeAppointment } from "@/lib/appointment-change";
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
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${c.organisationId}:scheduling`}))`);
    return changeAppointment(tx,c,v);
  });
}
