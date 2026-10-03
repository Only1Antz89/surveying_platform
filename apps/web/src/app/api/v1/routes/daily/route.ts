import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import { appointments, createDatabase, jobs, organisationOperationalSettings, properties, withTenant } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";

function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180; const radius = 6_371_000;
  const dLat = radians(b.latitude - a.latitude); const dLon = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
}

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const value = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return problem(400, "invalid_date", "Use a date in YYYY-MM-DD format.");
  if (context.demo) return ok({ date: value, stops: [], provider: { status: "not_configured" } }, { demo: true });
  const start = new Date(`${value}T00:00:00Z`); const end = new Date(start.getTime() + 86_400_000);
  const data = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [settings, visits] = await Promise.all([
      tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).limit(1).then((rows) => rows[0]),
      tx.select({ appointment: appointments, reference: jobs.reference, address: properties.line1, city: properties.city, postcode: properties.postcode, latitude: properties.latitude, longitude: properties.longitude, locationConfidence: properties.locationConfidence }).from(appointments).innerJoin(jobs, and(eq(jobs.id, appointments.jobId), eq(jobs.organisationId, appointments.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, appointments.organisationId))).where(and(eq(appointments.organisationId, context.organisationId), ne(appointments.status, "cancelled"), gte(appointments.startsAt, start), lt(appointments.startsAt, end))).orderBy(asc(appointments.startsAt)),
    ]); return { settings, visits };
  });
  const points = data.visits.flatMap((visit) => visit.latitude == null || visit.longitude == null ? [] : [{ latitude: visit.latitude, longitude: visit.longitude }]);
  const origin = data.settings?.officeLatitude == null || data.settings.officeLongitude == null ? null : { latitude: data.settings.officeLatitude, longitude: data.settings.officeLongitude };
  const estimates = points.map((point, index) => distanceMetres(index ? points[index - 1]! : origin ?? point, point));
  let provider: Record<string, unknown> = { status: process.env.ROUTING_PROVIDER_URL ? "unavailable" : "not_configured", attribution: process.env.ROUTING_PROVIDER_ATTRIBUTION ?? null };
  if (process.env.ROUTING_PROVIDER_URL && points.length > 1) {
    const coordinates = [origin, ...points].filter(Boolean).map((point) => `${point!.longitude},${point!.latitude}`).join(";");
    try { const response = await fetch(`${process.env.ROUTING_PROVIDER_URL.replace(/\/$/, "")}/route/v1/driving/${coordinates}?overview=false&steps=false`, { headers: process.env.ROUTING_PROVIDER_TOKEN ? { authorization: `Bearer ${process.env.ROUTING_PROVIDER_TOKEN}` } : {}, signal: AbortSignal.timeout(8_000) }); const body = await response.json() as { routes?: Array<{ distance: number; duration: number }> }; if (response.ok && body.routes?.[0]) provider = { status: "available", distanceMetres: Math.round(body.routes[0].distance), durationSeconds: Math.round(body.routes[0].duration), attribution: process.env.ROUTING_PROVIDER_ATTRIBUTION ?? null }; } catch { provider = { ...provider, status: "unavailable" }; }
  }
  return ok({ date: value, provider, stops: data.visits.map((visit, index) => ({ id: visit.appointment.id, reference: visit.reference, startsAt: visit.appointment.startsAt, address: `${visit.address}, ${visit.city}, ${visit.postcode}`, coordinates: visit.latitude == null || visit.longitude == null ? null : { latitude: visit.latitude, longitude: visit.longitude }, precision: visit.locationConfidence === "surveyor_confirmed" ? "surveyor_verified" : visit.latitude == null ? "unknown" : "approximate", confidence: visit.locationConfidence, directDistanceMetres: estimates[index] ?? null, openInMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(visit.latitude == null ? `${visit.address}, ${visit.city}, ${visit.postcode}` : `${visit.latitude},${visit.longitude}`)}` })) });
}
