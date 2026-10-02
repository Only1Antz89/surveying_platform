import { processIntelligenceQueue } from "@/lib/intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Authenticated consumer for due or abandoned intelligence jobs (external scheduler or queue push). */
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.QUEUE_CONSUMER_SECRET || authorization !== `Bearer ${process.env.QUEUE_CONSUMER_SECRET}`) return Response.json({ error: "Unauthorised queue delivery." }, { status: 401 });
  return Response.json({ accepted: true, result: await processIntelligenceQueue(10) });
}
