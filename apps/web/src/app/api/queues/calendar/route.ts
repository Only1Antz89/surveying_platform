import { processCalendarQueue } from "@/lib/calendar-sync";
export const runtime = "nodejs"; export const maxDuration = 60;
export async function POST(request: Request) { if (!process.env.QUEUE_CONSUMER_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.QUEUE_CONSUMER_SECRET}`) return Response.json({ error: "Unauthorised queue delivery." }, { status: 401 }); return Response.json({ accepted: true, result: await processCalendarQueue(10) }); }
