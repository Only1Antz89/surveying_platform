import "server-only";
import { and, asc, count, eq, gte, lt, notInArray } from "drizzle-orm";
import { appointments, businessLocations, createDatabase, jobs, organisationMemberships, serviceDefinitions, staffCapabilities, users, withTenant } from "@surveynt/db";
import { jobs as demoJobs, members } from "./demo-data";
import { localDayRange } from "./scheduling";
import { orderSurveyorCapacity, type SurveyorCapacity } from "./surveyor-capacity";
import type { OperationsContext } from "./staff-operations";

export async function loadSurveyorCapacity(context: OperationsContext): Promise<SurveyorCapacity[]> {
  if(context.demo) return orderSurveyorCapacity(members.filter(member=>member.status==="Active" && member.role==="surveyor").map(member=>({
    id:member.id,name:member.name,initials:member.initials,base:null,services:[],capacityJobs:null,
    activeJobs:demoJobs.filter(job=>job.assignee===member.name && !["paid","archived"].includes(job.stage)).length,
    inspectionsToday:demoJobs.filter(job=>job.assignee===member.name && job.stage==="scheduled" && job.target.startsWith("Today")).length,
  })));
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const {start,end}=localDayRange(day);
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    const [staff,work,visits,services]=await Promise.all([
      tx.select({id:organisationMemberships.id,firstName:users.firstName,lastName:users.lastName,email:users.email,userId:users.id,base:businessLocations.name,capacity:staffCapabilities.capacityJobs,serviceIds:staffCapabilities.serviceIds}).from(organisationMemberships)
        .innerJoin(users,eq(users.id,organisationMemberships.userId))
        .leftJoin(staffCapabilities,and(eq(staffCapabilities.organisationId,context.organisationId),eq(staffCapabilities.userId,users.id)))
        .leftJoin(businessLocations,and(eq(businessLocations.organisationId,context.organisationId),eq(businessLocations.id,staffCapabilities.primaryLocationId),eq(businessLocations.active,true)))
        .where(and(eq(organisationMemberships.organisationId,context.organisationId),eq(organisationMemberships.active,true),eq(organisationMemberships.role,"surveyor"))).orderBy(asc(users.firstName)),
      tx.select({userId:jobs.assignedSurveyorId,total:count()}).from(jobs).where(and(eq(jobs.organisationId,context.organisationId),notInArray(jobs.stage,["paid","archived"]))).groupBy(jobs.assignedSurveyorId),
      tx.select({userId:appointments.surveyorId,total:count()}).from(appointments).where(and(eq(appointments.organisationId,context.organisationId),eq(appointments.status,"confirmed"),gte(appointments.startsAt,start),lt(appointments.startsAt,end))).groupBy(appointments.surveyorId),
      tx.select({id:serviceDefinitions.id,name:serviceDefinitions.name}).from(serviceDefinitions).where(and(eq(serviceDefinitions.organisationId,context.organisationId),eq(serviceDefinitions.active,true))),
    ]);
    return orderSurveyorCapacity(staff.map(person=>{const name=[person.firstName,person.lastName].filter(Boolean).join(" ")||person.email;return {
      id:person.id,name,initials:name.split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase(),base:person.base,capacityJobs:person.capacity,
      services:services.filter(service=>person.serviceIds?.includes(service.id)).map(service=>service.name),
      activeJobs:work.find(row=>row.userId===person.userId)?.total??0,inspectionsToday:visits.find(row=>row.userId===person.userId)?.total??0,
    };}));
  });
}
