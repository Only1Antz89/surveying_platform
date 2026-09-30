import { emailDeliveryConfigured } from "@/lib/email";
import { enqueueDailyNotifications, processEmailQueue } from "@/lib/email-queue";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: "Unauthorised scheduled run." }, { status: 401 });
  if (!process.env.DATABASE_ADMIN_URL) return Response.json({ error: "Scheduled notification storage is not configured." }, { status: 503 });
  const scheduled = await enqueueDailyNotifications();
  const delivery = emailDeliveryConfigured()
    ? await processEmailQueue(30)
    : { configured: false, claimed: 0, completed: 0, retried: 0, failed: 0 };
  return Response.json({ ok: true, scheduled, delivery });
}
