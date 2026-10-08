import {workspaceAudit} from "@/lib/workspace-audit";
import "server-only";
import {clerkClient} from "@clerk/nextjs/server";
import {and,eq,notInArray} from "drizzle-orm";
import {createDatabase,withTenant,businessLocations,staffCapabilities,organisationMemberships,serviceDefinitions,users,userProfiles,jobs,auditEvents} from "@surveynt/db";
import {z} from "zod";
import {members} from "./demo-data";
export const locationInput=z.object({name:z.string().trim().min(2).max(120),address:z.string().trim().min(3).max(500),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),active:z.boolean(),version:z.number().int().positive().optional()}).refine(v=>(v.latitude===null)===(v.longitude===null),{message:"Provide both coordinates or leave both unset."});
export const capabilityInput=z.object({primaryLocationId:z.uuid().nullable(),serviceIds:z.array(z.uuid()).max(100),locationIds:z.array(z.uuid()).max(100),coverageRadiusKm:z.number().positive().max(500).nullable(),membershipGrade:z.string().trim().max(80).nullable(),registrationStatus:z.enum(["unset","declared","reviewed"]),contactPhone:z.string().trim().max(50).nullable(),capacityJobs:z.number().int().positive().max(1000).nullable(),version:z.number().int().positive()});
export type OperationsContext={organisationId:string;internalUserId:string|null;role:string;demo?:boolean};
export async function listLocations(context:OperationsContext){if(context.demo)return [];return withTenant(createDatabase(),context.organisationId,tx=>tx.select().from(businessLocations).where(eq(businessLocations.organisationId,context.organisationId)));}
export async function staffProfile(context:OperationsContext,membershipId:string){
 if(context.demo){const m=members.find(m=>m.id===membershipId&&m.status==="Active");return m?{...m,userId:m.id,ricsNumber:null,portraitUrl:null as string|null,capability:null,locations:[],services:[],activeJobs:Number(m.workload.split(" ")[0])}:null;}
 const data=await withTenant(createDatabase(),context.organisationId,async tx=>{
  const [member]=await tx.select({membership:organisationMemberships,user:users}).from(organisationMemberships).innerJoin(users,eq(users.id,organisationMemberships.userId)).where(and(eq(organisationMemberships.organisationId,context.organisationId),eq(organisationMemberships.id,membershipId),eq(organisationMemberships.active,true))).limit(1);
  if(!member)return null;
  const [[capability],locations,services,work]=await Promise.all([tx.select().from(staffCapabilities).where(and(eq(staffCapabilities.organisationId,context.organisationId),eq(staffCapabilities.userId,member.user.id))).limit(1),tx.select().from(businessLocations).where(eq(businessLocations.organisationId,context.organisationId)),tx.select().from(serviceDefinitions).where(eq(serviceDefinitions.organisationId,context.organisationId)),tx.select({id:jobs.id}).from(jobs).where(and(eq(jobs.organisationId,context.organisationId),eq(jobs.assignedSurveyorId,member.user.id),notInArray(jobs.stage,["paid","archived"]))) ]);
  return {...member,capability:capability??null,locations,services,activeJobs:work.length};
 });
 if(!data)return null;
 // RLS on personal profiles is deliberately not widened. Membership was checked above,
 // and only the professional identifier is projected by the server administration connection.
 const [professional]=process.env.DATABASE_ADMIN_URL?await createDatabase(process.env.DATABASE_ADMIN_URL).select({ricsNumber:userProfiles.ricsNumber}).from(userProfiles).where(eq(userProfiles.userId,data.user.id)).limit(1):[];
 let portraitUrl:string|null=null;if(process.env.CLERK_SECRET_KEY){try{portraitUrl=(await (await clerkClient()).users.getUser(data.user.clerkUserId)).imageUrl;}catch{/* Initials remain available when identity imagery cannot be loaded. */}}
 const name=[data.user.firstName,data.user.lastName].filter(Boolean).join(" ")||data.user.email;
 return {id:data.membership.id,userId:data.user.id,name,email:data.user.email,initials:name.split(/\s/).map(p=>p[0]).join("").slice(0,2),role:data.membership.role,portraitUrl,ricsNumber:professional?.ricsNumber??null,capability:data.capability,locations:data.locations,services:data.services,activeJobs:data.activeJobs};
}
export async function saveCapability(context:OperationsContext,membershipId:string,input:z.infer<typeof capabilityInput>){
 return withTenant(createDatabase(),context.organisationId,async tx=>{
 const [member]=await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.id,membershipId),eq(organisationMemberships.organisationId,context.organisationId),eq(organisationMemberships.active,true))).for("update");if(!member)throw Error("Staff member not found.");
 const locations=await tx.select().from(businessLocations).where(and(eq(businessLocations.organisationId,context.organisationId),eq(businessLocations.active,true)));
 const services=await tx.select().from(serviceDefinitions).where(and(eq(serviceDefinitions.organisationId,context.organisationId),eq(serviceDefinitions.active,true)));
 if(input.locationIds.some(id=>!locations.some(l=>l.id===id))||input.primaryLocationId&&!locations.some(l=>l.id===input.primaryLocationId)||input.serviceIds.some(id=>!services.some(s=>s.id===id)))throw Error("Select active services and locations from this practice.");
 const [saved]=await tx.select().from(staffCapabilities).where(and(eq(staffCapabilities.organisationId,context.organisationId),eq(staffCapabilities.userId,member.userId))).for("update");
 if((saved?.version??1)!==input.version)throw Error("This profile changed. Reload before saving.");
 const value={...input,version:(saved?.version??0)+1,reviewedByUserId:input.registrationStatus==="reviewed"?context.internalUserId:null,reviewedAt:input.registrationStatus==="reviewed"?new Date():null,updatedAt:new Date()};
 if(saved)await tx.update(staffCapabilities).set(value).where(eq(staffCapabilities.id,saved.id));else await tx.insert(staffCapabilities).values({...value,organisationId:context.organisationId,userId:member.userId});
 await tx.insert(auditEvents).values(workspaceAudit(context,{organisationId:context.organisationId,actorUserId:context.internalUserId,action:"staff.capabilities_updated",resourceType:"membership",resourceId:membershipId,metadata:{serviceIds:input.serviceIds,registrationStatus:input.registrationStatus}}));return {version:value.version};
 });
}
