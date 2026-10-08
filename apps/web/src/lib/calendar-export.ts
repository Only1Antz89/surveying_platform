import { createHash } from "node:crypto";
import type { appointments } from "@surveynt/db";
import type { CalendarProvider } from "./calendar-oauth";

export async function createExternalEvent(provider: CalendarProvider, accessToken: string, appointment: Pick<typeof appointments.$inferSelect,"id"|"startsAt"|"endsAt">, connectionId:string, fetcher:typeof fetch=fetch) {
  const google = provider === "google"; const url = google ? "https://www.googleapis.com/calendar/v3/calendars/primary/events" : "https://graph.microsoft.com/v1.0/me/events";
  const identity = createHash("sha256").update(`surveynt-calendar:${connectionId}:${appointment.id}`).digest("hex");
  const payload = google ? { id: identity, summary: "Surveynt property inspection", description: `Surveynt appointment ${appointment.id}`, start: { dateTime: appointment.startsAt.toISOString() }, end: { dateTime: appointment.endsAt.toISOString() }, extendedProperties: { private: { surveyntAppointmentId: appointment.id } } } : { transactionId: identity, subject: "Surveynt property inspection", body: { contentType: "text", content: `Surveynt appointment ${appointment.id}` }, start: { dateTime: appointment.startsAt.toISOString(), timeZone: "UTC" }, end: { dateTime: appointment.endsAt.toISOString(), timeZone: "UTC" }, categories: [`surveynt:${appointment.id}`] };
  let response = await fetcher(url, { method: "POST", redirect:"error", signal:AbortSignal.timeout(15000), headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  const recovered=google&&response.status===409;
  if(recovered)response=await fetcher(`${url}/${identity}`,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${accessToken}`}});
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof body.id !== "string" || !body.id || (google && body.id!==identity)) throw new Error("Appointment could not be exported to the calendar.");
  if(recovered){
    const properties=body.extendedProperties as {private?:{surveyntAppointmentId?:string}}|undefined;
    const start=body.start as {dateTime?:string}|undefined,end=body.end as {dateTime?:string}|undefined;
    if(body.id!==identity||properties?.private?.surveyntAppointmentId!==appointment.id||body.status==="cancelled"||new Date(start?.dateTime??"").getTime()!==appointment.startsAt.getTime()||new Date(end?.dateTime??"").getTime()!==appointment.endsAt.getTime())throw new Error("Previously exported calendar event differs. Review is required before linking it.");
  }
  return { id: body.id, version: String(body.etag ?? body.changeKey ?? "") || null };
}
