import { processIntelligenceQueue } from "@/lib/property-intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const expected = process.env.QUEUE_CONSUMER_SECRET ?? process.env.CRON_SECRET;
  if (!expected || authorization !== `Bearer ${expected}`) return Response.json({ error: "Unauthorised queue run." }, { status: 401 });
  if (!process.env.DATABASE_ADMIN_URL) return Response.json({ error: "Property intelligence storage is not configured." }, { status: 503 });
  return Response.json({ ok: true, processing: await processIntelligenceQueue(5) });
}
