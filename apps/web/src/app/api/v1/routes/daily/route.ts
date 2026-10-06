import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { appointments, clients, users, createDatabase, jobs, memberWorkProfiles, organisationOperationalSettings, properties, withTenant } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
import { localDayRange } from "@/lib/scheduling";
import { normaliseRoadRoute, validDay } from "@/lib/fieldwork";
import { assignedJobScope } from "@/lib/workspace-scope";
import { localFieldworkDemo } from "@/lib/fieldwork-demo";

function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180; const radius = 6_371_000;
  const dLat = radians(b.latitude - a.latitude); const dLon = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
}

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const value = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10); if (!validDay(value)) return problem(400, "invalid_date", "Use a date in YYYY-MM-DD format.");
  if (context.demo) return ok(localFieldworkDemo(value), { demo: true, persisted: false });
  const surveyor = new URL(request.url).searchParams.get("surveyor");
  if (surveyor && !/^[0-9a-f-]{36}$/i.test(surveyor)) return problem(400,"invalid_surveyor","Select a valid surveyor.");
  if(context.role==="surveyor" && surveyor && surveyor!==context.internalUserId) return problem(403,"forbidden","Only your assigned fieldwork is available.");
  const {start,end}=localDayRange(value);
  const data = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [settings, personal, visits] = await Promise.all([
      tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).limit(1).then((rows) => rows[0]),
      context.internalUserId?tx.select().from(memberWorkProfiles).where(and(eq(memberWorkProfiles.organisationId,context.organisationId),eq(memberWorkProfiles.userId,context.internalUserId))).limit(1).then(rows=>rows[0]):Promise.resolve(undefined),
      tx.select({ appointment: appointments, jobId: jobs.id, propertyId: properties.id, serviceName: jobs.serviceName, clientName: clients.displayName, propertyType: properties.propertyType, firstName: users.firstName, lastName: users.lastName, reference: jobs.reference, address: properties.line1, city: properties.city, postcode: properties.postcode, latitude: properties.latitude, longitude: properties.longitude, locationConfidence: properties.locationConfidence }).from(appointments).innerJoin(jobs, and(eq(jobs.id, appointments.jobId), eq(jobs.organisationId, appointments.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, appointments.organisationId))).innerJoin(clients,and(eq(clients.id,jobs.clientId),eq(clients.organisationId,appointments.organisationId))).leftJoin(users,eq(users.id,appointments.surveyorId)).where(and(assignedJobScope(context),eq(appointments.organisationId, context.organisationId), eq(appointments.status, "confirmed"), context.role === "surveyor" ? eq(appointments.surveyorId, context.internalUserId!) : undefined, gte(appointments.startsAt, start), lt(appointments.startsAt, end))).orderBy(asc(appointments.startsAt)),
    ]); return { settings, personal, visits };
  });
  const surveyors=[...new Map(data.visits.filter(v=>v.appointment.surveyorId).map(v=>[v.appointment.surveyorId!,{id:v.appointment.surveyorId!,name:[v.firstName,v.lastName].filter(Boolean).join(" ")||"Assigned surveyor"}])).values()];
  const selectedSurveyorId=context.role==="surveyor"?context.internalUserId:surveyor??surveyors[0]?.id??null;
  data.visits=data.visits.filter(v=>v.appointment.surveyorId===selectedSurveyorId);
  const simulated = await isDemoOrganisation(context.organisationId);
  const points = data.visits.flatMap((visit) => visit.latitude == null || visit.longitude == null ? [] : [{ latitude: visit.latitude, longitude: visit.longitude }]);
  const origin = selectedSurveyorId===context.internalUserId && data.personal?.latitude!=null&&data.personal.longitude!=null?{latitude:data.personal.latitude,longitude:data.personal.longitude}:data.settings?.officeLatitude == null || data.settings.officeLongitude == null ? null : { latitude: data.settings.officeLatitude, longitude: data.settings.officeLongitude };
  let previous = origin;
  const estimates = data.visits.map(visit=>{if(visit.latitude==null||visit.longitude==null){previous=null;return null;}const point={latitude:visit.latitude,longitude:visit.longitude};const result=previous?distanceMetres(previous,point):null;previous=point;return result;});
  let provider: Record<string, unknown> = { status: process.env.ROUTING_PROVIDER_URL ? "unavailable" : "not_configured", attribution: process.env.ROUTING_PROVIDER_ATTRIBUTION ?? null };
  if (simulated) provider={status:"demo",attribution:"Surveynt fictional route · straight-line distances only"};
  if (!simulated && process.env.ROUTING_PROVIDER_URL && points.length > 0 && data.visits.every(v=>v.latitude!=null&&v.longitude!=null)) {
    const coordinates = [origin, ...points].filter(Boolean).map((point) => `${point!.longitude},${point!.latitude}`).join(";");
    try { const response = await fetch(`${process.env.ROUTING_PROVIDER_URL.replace(/\/$/, "")}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, { headers: process.env.ROUTING_PROVIDER_TOKEN ? { authorization: `Bearer ${process.env.ROUTING_PROVIDER_TOKEN}` } : {}, signal: AbortSignal.timeout(8_000) }); const body = normaliseRoadRoute(await response.json(), points.length + (origin ? 1 : 0) - 1); if (response.ok && body) provider = { status: "available", ...body, attribution: process.env.ROUTING_PROVIDER_ATTRIBUTION ?? null }; } catch { provider = { ...provider, status: "unavailable" }; }
  }
  return ok({ date: value, origin, surveyors, selectedSurveyorId, provider, stops: data.visits.map((visit, index) => ({ id: visit.appointment.id, jobId: visit.jobId, propertyId: visit.propertyId, clientName: visit.clientName, serviceName: visit.serviceName, propertyType: visit.propertyType, endsAt: visit.appointment.endsAt, surveyorId: visit.appointment.surveyorId, surveyorName: surveyors.find(s=>s.id===visit.appointment.surveyorId)?.name ?? "Unassigned", reference: visit.reference, startsAt: visit.appointment.startsAt, address: `${visit.address}, ${visit.city}, ${visit.postcode}`, coordinates: visit.latitude == null || visit.longitude == null ? null : { latitude: visit.latitude, longitude: visit.longitude }, precision: visit.locationConfidence === "surveyor_confirmed" ? "surveyor_verified" : visit.latitude == null ? "unknown" : "approximate", confidence: visit.locationConfidence, directDistanceMetres: estimates[index] ?? null, openInMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(visit.latitude == null ? `${visit.address}, ${visit.city}, ${visit.postcode}` : `${visit.latitude},${visit.longitude}`)}` })) });
}
