import { and, desc, eq } from "drizzle-orm";
import { clients, createDatabase, jobs, properties, propertyIdentityEvents, users, withTenant } from "@surveynt/db";
import type { JobStage } from "@surveynt/domain";
import { addressFingerprint } from "@surveynt/property-data";
import { isClerkConfigured, requireFirmAccess } from "./access";
import { jobs as demoJobs, properties as demoProperties } from "./demo-data";
import { identityView } from "./property-identity";

const connected = () => Boolean(isClerkConfigured() && (process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PropertyIdentityView = ReturnType<typeof identityView>;

export type PropertyWorkspaceData = {
  demo: boolean;
  property: { id: string; line1: string; line2: string | null; city: string; postcode: string; propertyType: string | null; version: number; clientName: string };
  identity: PropertyIdentityView;
  identityEvents: { id: string; action: string; createdAt: string; actor: string; evidence: Record<string, unknown> }[];
  jobs: { id: string; reference: string; serviceName: string; stage: JobStage; targetDate: string | null }[];
};

const unresolvedIdentity: PropertyIdentityView = { country: null, uprn: null, latitude: null, longitude: null, locationConfidence: "unresolved", locationResolutionMethod: null, resolvedAt: null, uprnConfirmedAt: null, uprnEvidenceType: null, addressChangedSinceResolution: false };

export async function loadPropertyWorkspace(slug: string, id: string): Promise<PropertyWorkspaceData | null> {
  if (!connected()) {
    const property = demoProperties.find((item) => item.id === id);
    if (!property) return null;
    return {
      demo: true,
      property: { id: property.id, line1: property.address, line2: null, city: property.town, postcode: property.postcode, propertyType: property.type, version: property.version ?? 1, clientName: property.client },
      identity: unresolvedIdentity,
      identityEvents: [],
      jobs: demoJobs.filter((job) => job.address.includes(property.address)).map((job) => ({ id: job.id, reference: job.reference, serviceName: job.service, stage: job.stage, targetDate: null })),
    };
  }
  if (!uuidPattern.test(id)) return null;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const detail = await withTenant(db, context.organisationId, async (tx) => {
    const [row] = await tx.select({ property: properties, clientName: clients.displayName }).from(properties).innerJoin(clients, eq(properties.clientId, clients.id)).where(and(eq(properties.id, id), eq(properties.organisationId, context.organisationId))).limit(1);
    if (!row) return null;
    const linkedJobs = await tx.select({ id: jobs.id, reference: jobs.reference, serviceName: jobs.serviceName, stage: jobs.stage, targetDate: jobs.targetDate }).from(jobs).where(and(eq(jobs.propertyId, id), eq(jobs.organisationId, context.organisationId))).orderBy(desc(jobs.updatedAt));
    const events = await tx.select({ event: propertyIdentityEvents, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(propertyIdentityEvents).leftJoin(users, eq(propertyIdentityEvents.actorUserId, users.id)).where(and(eq(propertyIdentityEvents.propertyId, id), eq(propertyIdentityEvents.organisationId, context.organisationId))).orderBy(desc(propertyIdentityEvents.createdAt)).limit(25);
    return { ...row, linkedJobs, events };
  });
  if (!detail) return null;
  const { property } = detail;
  return {
    demo: false,
    property: { id: property.id, line1: property.line1, line2: property.line2, city: property.city, postcode: property.postcode, propertyType: property.propertyType, version: property.version, clientName: detail.clientName },
    identity: identityView(property, await addressFingerprint(property)),
    identityEvents: detail.events.map(({ event, firstName, lastName, email }) => ({ id: event.id, action: event.action, createdAt: event.createdAt.toISOString(), actor: [firstName, lastName].filter(Boolean).join(" ") || email || "System", evidence: event.evidence })),
    jobs: detail.linkedJobs,
  };
}
