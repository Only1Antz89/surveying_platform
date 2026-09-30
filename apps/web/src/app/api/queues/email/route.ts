import { emailDeliveryConfigured } from "@/lib/email";
import { processEmailQueue } from "@/lib/email-queue";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.QUEUE_CONSUMER_SECRET || authorization !== `Bearer ${process.env.QUEUE_CONSUMER_SECRET}`) return Response.json({ error: "Unauthorised queue delivery." }, { status: 401 });
  if (!emailDeliveryConfigured()) return Response.json({ error: "SMTP2GO delivery is not configured." }, { status: 503 });
  const result = await processEmailQueue(20);
  return Response.json({ accepted: true, result });
}
