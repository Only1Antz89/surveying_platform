import { enqueueGoogleSubscriptionReplacements,enqueueMicrosoftSubscriptionRenewals,processCalendarSubscriptionQueue } from "@/lib/calendar-subscription-queue";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
 if(!process.env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:"Unauthorised scheduled run."},{status:401});
 const deadline=Date.now()+50000;
 try{await enqueueMicrosoftSubscriptionRenewals();await enqueueGoogleSubscriptionReplacements();const result=await processCalendarSubscriptionQueue(10,deadline);return Response.json({result},{status:result.configured?200:503});}
 catch{return Response.json({error:"Calendar cleanup remains recorded for recovery."},{status:503});}
}
