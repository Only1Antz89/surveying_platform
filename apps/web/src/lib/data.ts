import { and, asc, count, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { auditEvents, createDatabase, clients, jobs, onboardingSteps, organisationMemberships, organisations, properties, subscriptions, users } from "@fieldnote/db";
import type { Client, Job, Member, Property, Tenant } from "./demo-data";
import { activities as demoActivities, clients as demoClients, jobs as demoJobs, members as demoMembers, properties as demoProperties, tenants as demoTenants } from "./demo-data";
import { isClerkConfigured, requireFirmAccess } from "./access";

const connected = () => Boolean(isClerkConfigured() && (process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL));

export type OverviewActivity = { id: string; text: string; time: string };
export type OverviewData = {
  activeJobs: number;
  inspectionsThisWeek: number;
  openClients: number;
  feesInProgress: number;
  onboardingProgress: number;
  workQueue: Job[];
  inspectionsToday: Job[];
  recentActivity: OverviewActivity[];
};

const formatTarget = (value: string | null) => value
  ? new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
  : "Not scheduled";

export async function loadOverviewForOrganisation(organisationId: string): Promise<OverviewData> {
  const db = createDatabase();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const day = now.getUTCDay() || 7;
  const weekStartDate = new Date(now);
  weekStartDate.setUTCDate(now.getUTCDate() - day + 1);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisationId}, true)`);
    const [jobSummary] = await tx.select({
      activeJobs: count(jobs.id),
      inspectionsThisWeek: sql<number>`count(*) filter (where ${jobs.stage} = 'scheduled' and ${jobs.targetDate} between ${weekStart} and ${weekEnd})`.mapWith(Number),
      feesInProgress: sql<number>`coalesce(sum(${jobs.fee}::numeric), 0)`.mapWith(Number),
    }).from(jobs).where(and(eq(jobs.organisationId, organisationId), ne(jobs.stage, "archived")));
    const [clientSummary] = await tx.select({ openClients: count(clients.id) })
      .from(clients)
      .where(and(eq(clients.organisationId, organisationId), isNull(clients.archivedAt)));
    const [onboardingSummary] = await tx.select({ completed: count(onboardingSteps.id) })
      .from(onboardingSteps)
      .where(and(eq(onboardingSteps.organisationId, organisationId), isNotNull(onboardingSteps.completedAt)));
    const recentRows = await tx.select({
      job: jobs,
      clientName: clients.displayName,
      address: properties.line1,
      city: properties.city,
      assigneeFirstName: users.firstName,
      assigneeLastName: users.lastName,
    }).from(jobs)
      .innerJoin(clients, eq(jobs.clientId, clients.id))
      .innerJoin(properties, eq(jobs.propertyId, properties.id))
      .leftJoin(users, eq(jobs.assignedSurveyorId, users.id))
      .where(and(eq(jobs.organisationId, organisationId), ne(jobs.stage, "archived")))
      .orderBy(desc(jobs.updatedAt))
      .limit(8);
    const activityRows = await tx.select({
      id: auditEvents.id,
      action: auditEvents.action,
      resourceType: auditEvents.resourceType,
      occurredAt: auditEvents.occurredAt,
    }).from(auditEvents)
      .where(eq(auditEvents.organisationId, organisationId))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(4);

    const mappedJobs: Job[] = recentRows.map(({ job, clientName, address, city, assigneeFirstName, assigneeLastName }) => ({
      id: job.id,
      reference: job.reference,
      client: clientName,
      address: `${address}, ${city}`,
      service: job.serviceName,
      stage: job.stage,
      assignee: [assigneeFirstName, assigneeLastName].filter(Boolean).join(" ") || "Unassigned",
      target: formatTarget(job.targetDate),
      fee: Number(job.fee ?? 0),
      priority: job.priority === "high" ? "High" : "Normal",
    }));
    return {
      activeJobs: jobSummary?.activeJobs ?? 0,
      inspectionsThisWeek: jobSummary?.inspectionsThisWeek ?? 0,
      openClients: clientSummary?.openClients ?? 0,
      feesInProgress: jobSummary?.feesInProgress ?? 0,
      onboardingProgress: Math.min(100, Math.round(((onboardingSummary?.completed ?? 0) / 4) * 100)),
      workQueue: mappedJobs.slice(0, 4),
      inspectionsToday: mappedJobs.filter((job) => recentRows.find((row) => row.job.id === job.id)?.job.targetDate === today && job.stage === "scheduled"),
      recentActivity: activityRows.map((activity) => ({
        id: activity.id,
        text: `${activity.action.replaceAll("_", " ")} · ${activity.resourceType.replaceAll("_", " ")}`,
        time: activity.occurredAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }),
      })),
    };
  });
}

export async function loadOverview(slug: string): Promise<OverviewData> {
  if (!connected()) return {
    activeJobs: 18,
    inspectionsThisWeek: 7,
    openClients: 42,
    feesInProgress: 21400,
    onboardingProgress: 86,
    workQueue: demoJobs.slice(0, 4),
    inspectionsToday: demoJobs.filter((job) => job.stage === "scheduled").slice(0, 2),
    recentActivity: demoActivities.map((activity, index) => ({ id: String(index), ...activity })),
  };
  const context = await requireFirmAccess(slug);
  return loadOverviewForOrganisation(context.organisationId);
}

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
