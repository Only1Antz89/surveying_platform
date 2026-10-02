import { emailDeliveryConfigured } from "@/lib/email";
import { enqueueDailyNotifications, processEmailQueue } from "@/lib/email-queue";
import { processIntelligenceQueue } from "@/lib/intelligence";
import { processMediaAnalysisBacklog } from "@/lib/media-analysis";

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
  const intelligence = await processIntelligenceQueue(10).catch(() => ({ claimed: 0, results: [], error: "Intelligence sweep failed." }));
  const media = await processMediaAnalysisBacklog(20).catch(() => ({ analysed: 0 }));
  return Response.json({ ok: true, scheduled, delivery, intelligence: { claimed: intelligence.claimed }, media: { analysed: media.analysed } });
}
