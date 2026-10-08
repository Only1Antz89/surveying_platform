import { processDocumentRemovalQueue } from "@/lib/document-removal";

export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request) {
  if(!process.env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:"Unauthorised scheduled run."},{status:401});
  if(!process.env.DATABASE_ADMIN_URL)return Response.json({error:"Document removal storage is not configured."},{status:503});
  try {
    const result=await processDocumentRemovalQueue(10);
    return Response.json({ok:result.configured,result},{status:result.configured?200:503});
  }catch{return Response.json({error:"Document removal sweep failed. Reviewed requests remain recorded for recovery."},{status:503});}
}
