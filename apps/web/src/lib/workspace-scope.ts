import { sql } from "drizzle-orm";
import { jobs, clients, properties, auditEvents, createDatabase, withTenant } from "@surveynt/db";
import type { OrganisationRole } from "@surveynt/domain";

export type WorkspaceViewer = { organisationId: string; role?: OrganisationRole; userRole?: OrganisationRole; internalUserId?: string | null };
export function assignedJobScope(context: WorkspaceViewer) {
  return (context.role ?? context.userRole) === "surveyor"
    ? sql`${jobs.assignedSurveyorId} = ${context.internalUserId ?? null}` : undefined;
}
export function assignedClientScope(context: WorkspaceViewer) {
  return (context.role ?? context.userRole) === "surveyor"
    ? sql`exists (select 1 from jobs scoped_job where scoped_job.organisation_id = ${context.organisationId} and scoped_job.client_id = ${clients.id} and scoped_job.assigned_surveyor_id = ${context.internalUserId ?? null})` : undefined;
}
export function assignedPropertyScope(context: WorkspaceViewer) {
  return (context.role ?? context.userRole) === "surveyor"
    ? sql`exists (select 1 from jobs scoped_job where scoped_job.organisation_id = ${context.organisationId} and scoped_job.property_id = ${properties.id} and scoped_job.assigned_surveyor_id = ${context.internalUserId ?? null})` : undefined;
}
export function assignedAuditScope(context: WorkspaceViewer) {
  if ((context.role ?? context.userRole) !== "surveyor") return undefined;
  return sql`exists (select 1 from jobs j where j.organisation_id = ${context.organisationId} and j.assigned_surveyor_id = ${context.internalUserId ?? null} and (
    (${auditEvents.resourceType} = 'job' and ${auditEvents.resourceId} = j.id)
    or (${auditEvents.resourceType} = 'property' and ${auditEvents.resourceId} = j.property_id)
    or (${auditEvents.resourceType} = 'survey' and exists (select 1 from surveys s where s.id = ${auditEvents.resourceId} and s.organisation_id = j.organisation_id and s.job_id = j.id))
    or (${auditEvents.resourceType} = 'appointment' and exists (select 1 from appointments a where a.id = ${auditEvents.resourceId} and a.organisation_id = j.organisation_id and a.job_id = j.id))
    or (${auditEvents.resourceType} = 'report_version' and exists (select 1 from report_versions r where r.id = ${auditEvents.resourceId} and r.organisation_id = j.organisation_id and r.job_id = j.id))
  ))`;
}
/** All identifiers are bound parameters; matching a customer never grants other jobs. */
export async function canAccessAssignedResource(context: WorkspaceViewer, type: string, id: string) {
  if ((context.role ?? context.userRole) !== "surveyor") return true;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const relation = type === "jobs" ? sql`j.id = ${id}`
      : type === "properties" ? sql`j.property_id = ${id}`
      : type === "clients" ? sql`j.client_id = ${id}`
      : type === "surveys" ? sql`exists (select 1 from surveys s where s.id = ${id} and s.organisation_id = j.organisation_id and s.job_id = j.id)`
      : type === "media" ? sql`exists (select 1 from media_assets m join surveys s on s.id = m.survey_id and s.organisation_id = m.organisation_id where m.id = ${id} and s.job_id = j.id and s.organisation_id = j.organisation_id)`
      : sql`false`;
    const result = await tx.execute(sql`select 1 from jobs j where j.organisation_id = ${context.organisationId} and j.assigned_surveyor_id = ${context.internalUserId ?? null} and ${relation} limit 1`);
    return Boolean((result as { rows: unknown[] }).rows.length);
  });
}

/** Fictional no-Clerk fixtures represent the signed-in owner, not an impersonated staff account. */
export function scopedDemoJobs<T extends {assignee:string;fee?:number}>(records:T[],role:OrganisationRole,name="Maya Patel"){return records.filter(j=>role!=="surveyor"||j.assignee===name).map(j=>role==="surveyor"?{...j,fee:undefined}:j);}
