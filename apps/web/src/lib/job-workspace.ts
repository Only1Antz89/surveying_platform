import { suggestedServiceScope } from "./service-scope";
import { and, desc, eq, ne } from "drizzle-orm";
import { appointments, clients, createDatabase, jobs, properties, surveys, withTenant } from "@surveynt/db";
import { requireFirmAccess } from "./access";
import { assignedJobScope } from "./workspace-scope";
import { jobs as previewJobs, properties as previewProperties } from "./demo-data";

export async function loadJobWorkspace(slug: string, id: string) {
  const access = await requireFirmAccess(slug);
  if (access.userId === "demo_user") {
    const job = previewJobs.find(row => row.id === id);
    if (!job) return null;
    const property = previewProperties.find(row => job.address.includes(row.address));
    return { job: { id, reference: job.reference, serviceName: job.service, stage: job.stage, targetDate: job.target, notes: null as string | null }, client: { id: "", displayName: job.client }, property: { id: property?.id ?? "", line1: property?.address ?? job.address, city: property?.town ?? "", postcode: property?.postcode ?? "" }, survey: { id: `demo-survey-${id}`, status: "in_progress", serviceLevel: suggestedServiceScope(job.service) ?? "bespoke", version: 1 }, appointments: [] as { id: string; startsAt: Date; endsAt: Date; status: string }[], preview: true };
  }
  if (!/^[0-9a-f-]{36}$/i.test(id) || access.userRole === "finance") return null;
  return withTenant(createDatabase(), access.organisationId, async tx => {
    const [record] = await tx.select({ job: { id: jobs.id, reference: jobs.reference, serviceName: jobs.serviceName, stage: jobs.stage, targetDate: jobs.targetDate, notes: jobs.notes }, client: { id: clients.id, displayName: clients.displayName }, property: { id: properties.id, line1: properties.line1, city: properties.city, postcode: properties.postcode } }).from(jobs).innerJoin(clients, eq(clients.id, jobs.clientId)).innerJoin(properties, eq(properties.id, jobs.propertyId)).where(and(eq(jobs.id, id), eq(jobs.organisationId, access.organisationId), assignedJobScope(access))).limit(1);
    if (!record) return null;
    const [surveyRows, visits] = await Promise.all([
      tx.select({ id: surveys.id, status: surveys.status, serviceLevel: surveys.serviceLevel, version: surveys.version }).from(surveys).where(and(eq(surveys.organisationId, access.organisationId), eq(surveys.jobId, id), ne(surveys.status, "withdrawn"))).orderBy(desc(surveys.createdAt)).limit(1),
      tx.select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status }).from(appointments).where(and(eq(appointments.organisationId, access.organisationId), eq(appointments.jobId, id))).orderBy(desc(appointments.startsAt)).limit(20),
    ]);
    return { ...record, survey: surveyRows[0] ?? null, appointments: visits, preview: false };
  });
}
