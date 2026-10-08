import { emailDeliveryConfigured } from "@/lib/email";
import { enqueueDailyNotifications, processEmailQueue } from "@/lib/email-queue";
import { processIntelligenceQueue } from "@/lib/intelligence";
import { processMediaAnalysisBacklog } from "@/lib/media-analysis";
import { runDataSourceSweep } from "@/lib/data-source-admin";
import { enqueueCalendarReconciliation, processCalendarQueue } from "@/lib/calendar-sync";
import { runLearningSweep } from "@/lib/learning-pipeline";

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
  const sources = await runDataSourceSweep().catch(() => ({ probed: 0, stale: [] }));
  const calendarScheduled = await enqueueCalendarReconciliation().catch(() => ({ eligible: 0, queued: 0 }));
  const calendars = await processCalendarQueue(10).catch(() => ({ claimed: 0, results: [] }));
  // Retries learning withdrawals and survey-file removals; extraction runs only while the programme is active.
  const learning = await runLearningSweep(5).catch(() => ({ withdrawals: 0, firms: 0, created: 0, error: "Learning sweep failed." }));
  return Response.json({ ok: true, scheduled, delivery, intelligence: { claimed: intelligence.claimed }, media: { analysed: media.analysed }, sources: { probed: sources.probed, releaseChecksDue: sources.stale.length }, calendars: { ...calendarScheduled, claimed: calendars.claimed }, learning: { withdrawals: learning.withdrawals, filesErased: "removedFiles" in learning ? learning.removedFiles?.files ?? 0 : 0, created: learning.created } });
}
