import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { appointments, auditEvents, createDatabase, jobs, jobStageEvents, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { readPublicQuote } from "@/lib/firm-operations";
import { ok, parseBody, problem } from "@/lib/api";
import { availableSurveyor, quoteSlots, schedulingAvailability } from "@/lib/booking-slots";
import { termsBlockBooking } from "@/lib/engagement-terms";
import { queueWorkflowMessage } from "@/lib/client-messages";

export async function GET(request:Request,route:RouteContext<"/api/v1/public/quotes/[id]/appointments">){
  const found=await readPublicQuote((await route.params).id,request.headers.get("x-quote-token")??"");
  if(!found?.row.jobId||found.row.status!=="converted"||!found.view.depositPaid)return problem(409,"deposit_required","An active quote and verified, unrefunded deposit are required before selecting a visit.");
  return ok(await quoteSlots(found.row.organisationId,Number(found.row.pricingSnapshot.durationMinutes??180)));
}

const schema = z.object({ startsAt: z.iso.datetime() });

export async function POST(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/appointments">) {
  const parsed = await parseBody(request, schema);
  if (!parsed.success) return problem(400, "invalid_request", "Select a valid appointment time.");
  const { id } = await route.params;
  const found = await readPublicQuote(id, request.headers.get("x-quote-token") ?? "");
  if (!found?.row.jobId||found.row.status!=="converted"||!found.view.depositPaid) return problem(409, "payment_pending", "An active quote and verified, unrefunded deposit are required before booking an appointment.");
  if (!process.env.DATABASE_ADMIN_URL) return problem(503, "scheduling_unavailable", "Scheduling is not configured.");
  const startsAt = new Date(parsed.data.startsAt);
  const duration = Number((found.row.pricingSnapshot as Record<string, unknown>).durationMinutes ?? 180);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const result = await withTenant(db, found.row.organisationId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${found.row.organisationId}:scheduling`}))`);
    const [existing]=await tx.select().from(appointments).where(and(eq(appointments.quoteId,found.row.id),eq(appointments.organisationId,found.row.organisationId))).limit(1);
    if(existing)return existing.status==="cancelled"?{kind:"unavailable" as const}:{kind:"created" as const,appointment:existing};
    const [job]=await tx.select().from(jobs).where(and(eq(jobs.id,found.row.jobId!),eq(jobs.organisationId,found.row.organisationId))).for("update").limit(1);
    if(!job||!["instructed","scheduled"].includes(job.stage))return {kind:"unavailable" as const};
    if(await termsBlockBooking(tx,found.row.organisationId,job.id))return {kind:"terms_required" as const};
    const [settings] = await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, found.row.organisationId)).limit(1);
    if (!settings) return { kind: "unavailable" as const };
    const timezone = settings.timezone;
    const bufferMs = settings.travelBufferMinutes * 60_000;
    const occupiedFrom = new Date(startsAt.getTime() - bufferMs); const occupiedUntil = new Date(endsAt.getTime() + bufferMs);
    const availability = await schedulingAvailability(tx, found.row.organisationId, occupiedFrom, occupiedUntil);
    const surveyorId = availableSurveyor(startsAt, endsAt, settings, availability);
    if (!surveyorId) return { kind: "unavailable" as const };
    const [appointment] = await tx.insert(appointments).values({ organisationId: found.row.organisationId, jobId: found.row.jobId!, quoteId: found.row.id, status: "confirmed", startsAt, endsAt, timezone, surveyorId }).returning();
    await tx.update(jobs).set({ stage: "scheduled", assignedSurveyorId: surveyorId, version:job.version+1, targetDate: new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(startsAt), updatedAt: new Date() }).where(and(eq(jobs.id, found.row.jobId!), eq(jobs.organisationId, found.row.organisationId)));
    if(job.stage!=="scheduled")await tx.insert(jobStageEvents).values({organisationId:found.row.organisationId,jobId:job.id,fromStage:job.stage,toStage:"scheduled",reason:"Customer selected an available appointment"});
    await queueWorkflowMessage(tx, { organisationId: found.row.organisationId, jobId: job.id, key: "booking_confirmed", dedupKey: `booking:${appointment.id}`, values: {
      appointmentDate: startsAt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }),
      appointmentTime: startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone }),
    } });
    await tx.insert(auditEvents).values({ organisationId: found.row.organisationId, action: "appointment.confirmed", resourceType: "appointment", resourceId: appointment.id, metadata: { jobId: found.row.jobId, surveyorId, startsAt: startsAt.toISOString() } });
    return { kind: "created" as const, appointment };
  });
  if (result.kind === "terms_required") return problem(409, "terms_required", "Please sign the terms of engagement before booking your visit.");
  return result.kind === "created" ? ok(result.appointment) : problem(409, "slot_unavailable", "That appointment is no longer available. Choose another time.");
}
