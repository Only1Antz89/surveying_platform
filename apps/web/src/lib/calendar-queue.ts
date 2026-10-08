import { and,eq,isNull,lte,or } from "drizzle-orm";
import { backgroundJobs,type Database } from "@surveynt/db";

export async function recoverCalendarLeases(db:Database,now=new Date()){
  const rows=await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue,"calendar"),eq(backgroundJobs.status,"processing"),or(lte(backgroundJobs.lockedUntil,now),and(isNull(backgroundJobs.lockedUntil),lte(backgroundJobs.updatedAt,new Date(now.getTime()-300000))))));
  let recovered=0;
  for(const job of rows){
    const legacy=!job.leaseToken,exhausted=job.attempts>=5;
    const [updated]=await db.update(backgroundJobs).set({status:legacy||exhausted?"failed":"queued",lockedUntil:null,leaseToken:null,availableAt:now,failedAt:legacy||exhausted?now:null,error:legacy?"Interrupted legacy calendar export requires provider review before retry.":exhausted?"Calendar retry limit reached after an interrupted attempt.":"Interrupted calendar attempt recovered.",updatedAt:now}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.attempts,job.attempts),job.leaseToken?eq(backgroundJobs.leaseToken,job.leaseToken):isNull(backgroundJobs.leaseToken),job.lockedUntil?eq(backgroundJobs.lockedUntil,job.lockedUntil):isNull(backgroundJobs.lockedUntil))).returning({id:backgroundJobs.id});
    if(updated)recovered++;
  }
  return recovered;
}

/** Only the current claim can publish completion or retry state. */
export async function finishCalendarAttempt(db:Database,id:string,token:string,values:Partial<typeof backgroundJobs.$inferInsert>){
  const [updated]=await db.update(backgroundJobs).set({...values,lockedUntil:null,updatedAt:new Date()}).where(and(eq(backgroundJobs.id,id),eq(backgroundJobs.queue,"calendar"),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,token))).returning({id:backgroundJobs.id});return !!updated;
}
