import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { and, asc, eq, gte, lt, inArray } from "drizzle-orm";
import { appointments, clients, users, createDatabase, jobs, memberWorkProfiles, organisationOperationalSettings, properties, jobSiteStatuses, withTenant } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
import { localDayRange, localParts } from "@/lib/scheduling";
import { normaliseRoadRoute, validDay } from "@/lib/fieldwork";
import { assignedJobScope } from "@/lib/workspace-scope";
import {enabledConnection} from "@/lib/platform-connections";
import {connectionJson} from "@/lib/connection-network";
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
  const requestedDate = new URL(request.url).searchParams.get("date")||null; if (requestedDate && !validDay(requestedDate)) return problem(400, "invalid_date", "Use a date in YYYY-MM-DD format.");
  if(context.demo){const demo=localFieldworkDemo(requestedDate??localParts(new Date(),"Europe/London").date);if(context.role==="surveyor"){demo.stops=demo.stops.filter(s=>s.surveyorName==="Maya Patel");demo.surveyors=demo.surveyors.filter(s=>s.name==="Maya Patel");demo.selectedSurveyorId=demo.surveyors[0]?.id??null;}return ok(demo,{demo:true,persisted:false});}
  const surveyor = new URL(request.url).searchParams.get("surveyor");
  if (surveyor && !/^[0-9a-f-]{36}$/i.test(surveyor)) return problem(400,"invalid_surveyor","Select a valid surveyor.");
  if(context.role==="surveyor" && surveyor && surveyor!==context.internalUserId) return problem(403,"forbidden","Only your assigned fieldwork is available.");
  const overview = new URL(request.url).searchParams.get("overview") === "1";
  if(overview && !["owner","administrator","manager"].includes(context.role))return problem(403,"forbidden","Management access is required for the practice fieldwork overview.");
  const [operating]=await withTenant(createDatabase(),context.organisationId,tx=>tx.select({timezone:organisationOperationalSettings.timezone}).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).limit(1));
  const timezone=operating?.timezone??"Europe/London";
  const value=requestedDate??localParts(new Date(),timezone).date;
  const {start,end}=localDayRange(value,timezone);
  const data = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [settings, personal, visits] = await Promise.all([
      tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).limit(1).then((rows) => rows[0]),
      context.internalUserId?tx.select().from(memberWorkProfiles).where(and(eq(memberWorkProfiles.organisationId,context.organisationId),eq(memberWorkProfiles.userId,context.internalUserId))).limit(1).then(rows=>rows[0]):Promise.resolve(undefined),
      tx.select({ appointment: appointments, jobId: jobs.id, propertyId: properties.id, serviceName: jobs.serviceName, clientName: clients.displayName, propertyType: properties.propertyType, firstName: users.firstName, lastName: users.lastName, reference: jobs.reference, address: properties.line1, city: properties.city, postcode: properties.postcode, latitude: properties.latitude, longitude: properties.longitude, locationConfidence: properties.locationConfidence, siteStatus:jobSiteStatuses.status, siteConfirmedAt:jobSiteStatuses.confirmedAt }).from(appointments).innerJoin(jobs, and(eq(jobs.id, appointments.jobId), eq(jobs.organisationId, appointments.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, appointments.organisationId))).innerJoin(clients,and(eq(clients.id,jobs.clientId),eq(clients.organisationId,appointments.organisationId))).leftJoin(users,eq(users.id,appointments.surveyorId)).leftJoin(jobSiteStatuses,and(eq(jobSiteStatuses.organisationId,context.organisationId),eq(jobSiteStatuses.jobId,jobs.id),eq(jobSiteStatuses.userId,appointments.surveyorId))).where(and(assignedJobScope(context),eq(appointments.organisationId, context.organisationId), inArray(appointments.status, ["confirmed","completed"]), context.role === "surveyor" ? eq(appointments.surveyorId, context.internalUserId!) : undefined, gte(appointments.startsAt, start), lt(appointments.startsAt, end))).orderBy(asc(appointments.startsAt)),
    ]); return { settings, personal, visits };
  });
  const surveyors=[...new Map(data.visits.filter(v=>v.appointment.surveyorId).map(v=>[v.appointment.surveyorId!,{id:v.appointment.surveyorId!,name:[v.firstName,v.lastName].filter(Boolean).join(" ")||"Assigned surveyor"}])).values()];
  const selectedSurveyorId=context.role==="surveyor"?context.internalUserId:surveyor??surveyors[0]?.id??null;
  if(!overview || surveyor)data.visits=data.visits.filter(v=>v.appointment.surveyorId===selectedSurveyorId);
  const simulated = await isDemoOrganisation(context.organisationId);
  const points = data.visits.flatMap((visit) => visit.latitude == null || visit.longitude == null ? [] : [{ latitude: visit.latitude, longitude: visit.longitude }]);
  const origin = selectedSurveyorId===context.internalUserId && data.personal?.latitude!=null&&data.personal.longitude!=null?{latitude:data.personal.latitude,longitude:data.personal.longitude}:data.settings?.officeLatitude == null || data.settings.officeLongitude == null ? null : { latitude: data.settings.officeLatitude, longitude: data.settings.officeLongitude };
  let previous = origin;
  const estimates = data.visits.map(visit=>{if(visit.latitude==null||visit.longitude==null){previous=null;return null;}const point={latitude:visit.latitude,longitude:visit.longitude};const result=previous?distanceMetres(previous,point):null;previous=point;return result;});
  let configured=null;try{configured=await enabledConnection(context.organisationId,"routing");}catch{}
  let provider: Record<string, unknown> = {status:configured?"unavailable":"not_configured",attribution:"OSRM-compatible road estimates · not traffic-adjusted"};
  if(simulated)provider={status:"demo",attribution:"Surveynt fictional route · straight-line distances only"};
  if(!overview&&!simulated&&configured&&points.length>0&&data.visits.every(v=>v.latitude!=null&&v.longitude!=null)){
   const coordinates=[origin,...points].filter(Boolean).map(point=>`${point!.longitude},${point!.latitude}`).join(";");
   if(points.length+(origin?1:0)>1)try{const c=configured.connection;const raw=await connectionJson(c.endpoint,`/route/v1/driving/${coordinates}`,{secret:c.credentialEnv?process.env[c.credentialEnv]:undefined,query:{overview:"full",geometries:"geojson",steps:"false"}});const body=normaliseRoadRoute(raw,points.length+(origin?1:0)-1);if(body)provider={status:"available",...body,attribution:provider.attribution};}catch{}
  }
  return ok({ date: value, timezone, today:localParts(new Date(),timezone).date, showTomorrow:localParts(new Date(),timezone).minutes>=960, origin, surveyors, selectedSurveyorId, provider, stops: data.visits.map((visit, index) => ({ id: visit.appointment.id, jobId: visit.jobId, propertyId: visit.propertyId, clientName: visit.clientName, serviceName: visit.serviceName, siteStatus:visit.siteStatus,siteConfirmedAt:visit.siteConfirmedAt, propertyType: visit.propertyType, endsAt: visit.appointment.endsAt, surveyorId: visit.appointment.surveyorId, surveyorName: surveyors.find(s=>s.id===visit.appointment.surveyorId)?.name ?? "Unassigned", reference: visit.reference, startsAt: visit.appointment.startsAt, address: `${visit.address}, ${visit.city}, ${visit.postcode}`, coordinates: visit.latitude == null || visit.longitude == null ? null : { latitude: visit.latitude, longitude: visit.longitude }, precision: visit.locationConfidence === "surveyor_confirmed" ? "surveyor_verified" : visit.latitude == null ? "unknown" : "approximate", confidence: visit.locationConfidence, directDistanceMetres: estimates[index] ?? null, openInMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(visit.latitude == null ? `${visit.address}, ${visit.city}, ${visit.postcode}` : `${visit.latitude},${visit.longitude}`)}` })) });
}
