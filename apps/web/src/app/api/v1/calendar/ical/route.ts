import { and, asc, eq, gt } from "drizzle-orm";
import { appointments, createDatabase, jobs, properties, withTenant } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { problem } from "@/lib/api";

const escapeIcal = (value: string) => value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll(/\r?\n/g, "\\n");
const icalDate = (value: Date) => value.toISOString().replaceAll(/[-:]/g, "").replace(".000", "");

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication is required.");
  if (context.demo) return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Surveynt//Firm calendar//EN\r\nEND:VCALENDAR\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": "attachment; filename=surveynt-calendar.ics" } });
  const rows = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ appointment: appointments, reference: jobs.reference, line1: properties.line1, city: properties.city, postcode: properties.postcode }).from(appointments).innerJoin(jobs, and(eq(jobs.id, appointments.jobId), eq(jobs.organisationId, appointments.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, appointments.organisationId))).where(and(eq(appointments.organisationId, context.organisationId), gt(appointments.endsAt, new Date()), eq(appointments.status, "confirmed"))).orderBy(asc(appointments.startsAt)).limit(500));
  const events = rows.map(({ appointment, reference, line1, city, postcode }) => [
    "BEGIN:VEVENT", `UID:${appointment.id}@surveynt`, `DTSTAMP:${icalDate(appointment.updatedAt)}`, `DTSTART:${icalDate(appointment.startsAt)}`, `DTEND:${icalDate(appointment.endsAt)}`,
    `SUMMARY:${escapeIcal(`Surveynt inspection ${reference}`)}`, `LOCATION:${escapeIcal(`${line1}, ${city}, ${postcode}`)}`, `DESCRIPTION:${escapeIcal(`Surveynt job ${reference}`)}`, "END:VEVENT",
  ].join("\r\n")).join("\r\n");
  const body = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nPRODID:-//Surveynt//Firm calendar//EN\r\n${events}${events ? "\r\n" : ""}END:VCALENDAR\r\n`;
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": "attachment; filename=surveynt-calendar.ics", "cache-control": "private, no-store" } });
}
