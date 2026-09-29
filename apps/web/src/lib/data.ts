import { asc, desc, eq, sql } from "drizzle-orm";
import { createDatabase, clients, jobs, organisationMemberships, organisations, properties, subscriptions, users } from "@fieldnote/db";
import type { Client, Job, Member, Property, Tenant } from "./demo-data";
import { clients as demoClients, jobs as demoJobs, members as demoMembers, properties as demoProperties, tenants as demoTenants } from "./demo-data";
import { isClerkConfigured, requireFirmAccess } from "./access";

const connected = () => Boolean(isClerkConfigured() && process.env.DATABASE_URL);

export async function loadClients(slug: string): Promise<Client[]> {
  if (!connected()) return demoClients;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select().from(clients).where(eq(clients.organisationId, context.organisationId)).orderBy(asc(clients.displayName));
  });
  return rows.map((client) => ({ id: client.id, name: client.displayName, kind: client.kind === "company" ? "Company" : "Individual", email: client.email ?? "—", phone: client.phone ?? "—", properties: 0, lastActivity: client.updatedAt.toLocaleDateString("en-GB") }));
}

export async function loadProperties(slug: string): Promise<Property[]> {
  if (!connected()) return demoProperties;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select({ property: properties, clientName: clients.displayName }).from(properties).innerJoin(clients, eq(properties.clientId, clients.id)).where(eq(properties.organisationId, context.organisationId)).orderBy(asc(properties.line1));
  });
  return rows.map(({ property, clientName }) => ({ id: property.id, address: property.line1, town: property.city, postcode: property.postcode, type: property.propertyType ?? "Not recorded", client: clientName, activeJobs: 0 }));
}

export async function loadJobs(slug: string): Promise<Job[]> {
  if (!connected()) return demoJobs;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select({ job: jobs, clientName: clients.displayName, address: properties.line1, city: properties.city }).from(jobs).innerJoin(clients, eq(jobs.clientId, clients.id)).innerJoin(properties, eq(jobs.propertyId, properties.id)).where(eq(jobs.organisationId, context.organisationId)).orderBy(desc(jobs.updatedAt));
  });
  return rows.map(({ job, clientName, address, city }) => ({ id: job.id, reference: job.reference, client: clientName, address: `${address}, ${city}`, service: job.serviceName, stage: job.stage, assignee: job.assignedSurveyorId ? "Assigned surveyor" : "Unassigned", target: job.targetDate ?? "Not scheduled", fee: Number(job.fee ?? 0), priority: job.priority === "high" ? "High" : "Normal" }));
}

export async function loadMembers(slug: string): Promise<Member[]> {
  if (!connected()) return demoMembers;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select({ membership: organisationMemberships, user: users }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(eq(organisationMemberships.organisationId, context.organisationId)).orderBy(asc(users.firstName));
  });
  return rows.map(({ membership, user }) => { const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email; return { id: membership.id, name, email: user.email, initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), role: membership.role, status: membership.active ? "Active" : "Invited", workload: "Workload available after job assignment" }; });
}

export async function loadTenants(): Promise<Tenant[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return demoTenants;
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const rows = await db.select({ organisation: organisations, subscription: subscriptions }).from(organisations).leftJoin(subscriptions, eq(subscriptions.organisationId, organisations.id)).orderBy(desc(organisations.createdAt));
  return rows.map(({ organisation, subscription }) => ({ id: organisation.id, name: organisation.name, owner: "Owner available in members", plan: subscription?.planKey ?? "Pending", status: organisation.status, subscription: subscription?.status ?? "incomplete", seats: subscription?.seats ?? 1, trialEnds: subscription?.trialEndsAt?.toLocaleDateString("en-GB") ?? "—", onboarding: organisation.status === "active" ? 100 : 30, usage: 0, lastActive: organisation.updatedAt.toLocaleDateString("en-GB") }));
}
