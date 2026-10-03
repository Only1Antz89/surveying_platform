import { z } from "zod";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { appointments, auditEvents, availabilityBlocks, createDatabase, jobs, organisationOperationalSettings } from "@surveynt/db";
import { readPublicQuote } from "@/lib/firm-operations";
import { ok, parseBody, problem } from "@/lib/api";
import { localParts } from "@/lib/scheduling";

const schema = z.object({ startsAt: z.iso.datetime() });

function minuteValue(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export async function POST(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/appointments">) {
  const parsed = await parseBody(request, schema);
  if (!parsed.success) return problem(400, "invalid_request", "Select a valid appointment time.");
  const { id } = await route.params;
  const found = await readPublicQuote(id, request.headers.get("x-quote-token") ?? "");
  if (!found?.row.jobId) return problem(409, "payment_pending", "A verified deposit is required before booking an appointment.");
  if (!process.env.DATABASE_ADMIN_URL) return problem(503, "scheduling_unavailable", "Scheduling is not configured.");
  const startsAt = new Date(parsed.data.startsAt);
  const duration = Number((found.row.pricingSnapshot as Record<string, unknown>).durationMinutes ?? 180);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${found.row.organisationId}:${startsAt.toISOString().slice(0, 10)}`}))`);
    const [settings] = await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, found.row.organisationId)).limit(1);
    const horizon = settings?.bookingHorizonDays ?? 90;
    const timezone = settings?.timezone ?? "Europe/London";
    const localStart = localParts(startsAt, timezone); const localEnd = localParts(endsAt, timezone);
    const hours = settings?.workingHours?.[localStart.weekday] ?? { start: "09:00", end: "17:00" };
    if (startsAt <= new Date() || startsAt > new Date(Date.now() + horizon * 86_400_000)
      || !(settings?.workingDays ?? ["monday", "tuesday", "wednesday", "thursday", "friday"]).includes(localStart.weekday)
      || (settings?.holidayDates ?? []).includes(localStart.date) || localStart.date !== localEnd.date
      || localStart.minutes < minuteValue(hours.start) || localEnd.minutes > minuteValue(hours.end)) return { kind: "unavailable" as const };
    const bufferMs = (settings?.travelBufferMinutes ?? 30) * 60_000;
    const occupiedFrom = new Date(startsAt.getTime() - bufferMs); const occupiedUntil = new Date(endsAt.getTime() + bufferMs);
    const [busyAppointment, blocked] = await Promise.all([
      tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.organisationId, found.row.organisationId), ne(appointments.status, "cancelled"), lt(appointments.startsAt, occupiedUntil), gt(appointments.endsAt, occupiedFrom))).limit(1),
      tx.select({ id: availabilityBlocks.id }).from(availabilityBlocks).where(and(eq(availabilityBlocks.organisationId, found.row.organisationId), lt(availabilityBlocks.startsAt, occupiedUntil), gt(availabilityBlocks.endsAt, occupiedFrom))).limit(1),
    ]);
    if (busyAppointment.length || blocked.length) return { kind: "unavailable" as const };
    const [appointment] = await tx.insert(appointments).values({ organisationId: found.row.organisationId, jobId: found.row.jobId!, quoteId: found.row.id, status: "confirmed", startsAt, endsAt, timezone }).returning();
    await tx.update(jobs).set({ stage: "scheduled", targetDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(startsAt), updatedAt: new Date() }).where(and(eq(jobs.id, found.row.jobId!), eq(jobs.organisationId, found.row.organisationId)));
    await tx.insert(auditEvents).values({ organisationId: found.row.organisationId, action: "appointment.confirmed", resourceType: "appointment", resourceId: appointment.id, metadata: { jobId: found.row.jobId, startsAt: startsAt.toISOString() } });
    return { kind: "created" as const, appointment };
  });
  return result.kind === "created" ? ok(result.appointment) : problem(409, "slot_unavailable", "That appointment is no longer available. Choose another time.");
}
