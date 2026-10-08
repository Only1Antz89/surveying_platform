import { and, eq, gt, lt, ne } from "drizzle-orm";
import { appointments, availabilityBlocks, createDatabase, memberWorkProfiles, organisationMemberships, organisationOperationalSettings, withTenant, type TenantTransaction } from "@surveynt/db";
import { localParts } from "./scheduling";
export function withinWorkingHours(start:Date,end:Date,settings:{timezone:string;workingDays:string[];workingHours:Record<string,{start:string;end:string}>;holidayDates:string[];bookingHorizonDays:number},now=new Date()){
  const a=localParts(start,settings.timezone),b=localParts(end,settings.timezone);
  const hours=settings.workingHours[a.weekday]??{start:"09:00",end:"17:00"};const minute=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
  return Boolean(hours&&start>now&&start.getTime()<now.getTime()+settings.bookingHorizonDays*86400000&&settings.workingDays.includes(a.weekday)&&!settings.holidayDates.includes(a.date)&&a.date===b.date&&a.minutes>=minute(hours.start)&&b.minutes<=minute(hours.end));
}
export async function schedulingAvailability(tx:TenantTransaction,organisationId:string,from:Date,to:Date){
  const [members,profiles,visits,blocks]=await Promise.all([
    tx.select({id:organisationMemberships.userId,role:organisationMemberships.role}).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,organisationId),eq(organisationMemberships.active,true))),
    tx.select({userId:memberWorkProfiles.userId,timezone:memberWorkProfiles.timezone,workingHours:memberWorkProfiles.workingHours}).from(memberWorkProfiles).where(eq(memberWorkProfiles.organisationId,organisationId)),
    tx.select().from(appointments).where(and(eq(appointments.organisationId,organisationId),ne(appointments.status,"cancelled"),gt(appointments.endsAt,from),lt(appointments.startsAt,to))),
    tx.select().from(availabilityBlocks).where(and(eq(availabilityBlocks.organisationId,organisationId),gt(availabilityBlocks.endsAt,from),lt(availabilityBlocks.startsAt,to))),
  ]);
  return {members:members.filter(member=>["owner","administrator","surveyor"].includes(member.role)),profiles,visits,blocks};
}
export function availableSurveyor(start:Date,end:Date,settings:Parameters<typeof withinWorkingHours>[2]&{travelBufferMinutes:number},data:Awaited<ReturnType<typeof schedulingAvailability>>,now=new Date()){
  if(!withinWorkingHours(start,end,settings,now))return null;
  const buffer=settings.travelBufferMinutes*60000;
  for(const member of data.members){
    const profile=data.profiles.find(value=>value.userId===member.id),local=profile?localParts(start,profile.timezone):null;
    const hours=local&&profile?.workingHours[local.weekday];
    if(hours?.closed)continue;
    if(hours&&!withinWorkingHours(start,end,{...settings,timezone:profile!.timezone,workingDays:[local!.weekday],workingHours:{[local!.weekday]:hours},holidayDates:[]},now))continue;
    if(data.visits.some(visit=>(!visit.surveyorId||visit.surveyorId===member.id)&&visit.startsAt.getTime()<end.getTime()+buffer&&visit.endsAt.getTime()>start.getTime()-buffer))continue;
    if(data.blocks.some(block=>(!block.userId||block.userId===member.id)&&block.startsAt.getTime()<end.getTime()+buffer&&block.endsAt.getTime()>start.getTime()-buffer))continue;
    return member.id;
  }
  return null;
}
export async function quoteSlots(organisationId:string,durationMinutes:number){
  const db=createDatabase(process.env.DATABASE_ADMIN_URL);
  return withTenant(db,organisationId,async tx=>{
    const [settings]=await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,organisationId)).limit(1);
    if(!settings)return [];
    const now=new Date(),end=new Date(now.getTime()+Math.min(settings.bookingHorizonDays,21)*86400000);
    const data=await schedulingAvailability(tx,organisationId,now,end);
    const slots:{startsAt:string;endsAt:string;label:string}[]=[];
  for(let ms=Math.ceil(now.getTime()/1800000)*1800000;ms<end.getTime()&&slots.length<60;ms+=1800000){
    const start=new Date(ms),finish=new Date(ms+durationMinutes*60000);
    if(!availableSurveyor(start,finish,settings,data,now))continue;
    slots.push({startsAt:start.toISOString(),endsAt:finish.toISOString(),label:start.toLocaleString("en-GB",{timeZone:settings.timezone,weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})});
  }
    return slots;
  });
}
