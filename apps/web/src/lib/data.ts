import { assignedJobScope, assignedClientScope, assignedPropertyScope } from "@/lib/workspace-scope";
import { and, asc, count, desc, eq, gt, gte, lt, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { appointments, auditEvents, backgroundJobs, createDatabase, clients, invitations, jobs, onboardingSteps, organisationBranding, organisationMemberships, organisations, platformIncidentOrganisations, platformIncidents, platformStaff, practicePacks, practicePackVersions, properties, serviceDefinitions, subscriptions, supportSessions, users, webhookEvents } from "@surveynt/db";
import type { PlatformRole } from "@surveynt/domain";
import type { Client, Job, Member, Property, Tenant } from "./demo-data";
import { activities as demoActivities, clients as demoClients, jobs as demoJobs, members as demoMembers, properties as demoProperties, tenants as demoTenants } from "./demo-data";
import { isClerkConfigured, requireFirmAccess, requirePlatformAccess } from "./access";
import { localDayRange } from "./scheduling";

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
export type JobFormOptions = {
  clients: { id: string; name: string }[];
  properties: { id: string; clientId: string; label: string }[];
  surveyors: { id: string; name: string }[];
  coordinators: { id: string; name: string }[];
};
export type OrganisationSettings = {
  name: string;
  region: string;
  tradingName: string;
  supportEmail: string;
  accentColour: string;
  services: { id: string; name: string; defaultFee: string }[];
};
export type BillingSummary = {
  configured: boolean;
  planKey: string;
  status: "incomplete" | "trialing" | "active" | "past_due" | "unpaid" | "canceled";
  seats: number;
  activeMembers: number;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
};
export type SupportAccessRequest = {
  id: string;
  ticketReference: string;
  reason: string;
  expiresAt: string;
  requestedAt: string;
};
export type PlatformTenantDetail = {
  tenant: Tenant;
  region: string;
  practiceType: string;
  createdAt: string;
  branding: { tradingName: string; supportEmail: string; accentColour: string; logoUrl: string | null };
  subscription: { status: Tenant["subscription"]; planKey: string; seats: number; trialEndsAt: string | null; currentPeriodEndsAt: string | null; graceEndsAt: string | null; cancelAtPeriodEnd: boolean } | null;
  members: { id: string; name: string; email: string; role: Member["role"]; active: boolean }[];
  invitations: { id: string; email: string; role: Member["role"]; expiresAt: string }[];
  usage: { clients: number; properties: number; jobs: number; activeJobs: number };
  onboarding: { key: string; completedAt: string | null }[];
  audit: { id: string; action: string; resourceType: string; occurredAt: string; actor: string }[];
};
export type PlatformQueueRow = { id: string; primary: string; secondary: string; state: string; detail: string; href?: string; action?: string; actionEndpoint?: string; tone?: "blue" | "green" | "amber" | "red" | "slate" };
export type PracticePackRecord = {
  id: string;
  key: string;
  name: string;
  discipline: string;
  active: boolean;
  versions: { id: string; version: string; status: string; definition: Record<string, unknown>; publishedAt: string | null; createdAt: string }[];
};
export type PlatformIncidentRecord = {
  id: string;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "investigating" | "monitoring" | "resolved";
  startedAt: string;
  resolvedAt: string | null;
  affectedOrganisations: { id: string; name: string }[];
};
export type PlatformStaffRecord = {
  id: string;
  clerkUserId: string;
  name: string;
  email: string;
  role: PlatformRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const formatTarget = (value: string | null) => value
  ? new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
  : "Not scheduled";

export async function loadOverviewForOrganisation(organisationId: string): Promise<OverviewData> {
  const db = createDatabase();
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London"}).format(now);
  const weekStartDate = new Date(`${today}T12:00:00Z`);
  const day = weekStartDate.getUTCDay() || 7;
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - day + 1);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisationId}, true)`);
    const [jobSummary] = await tx.select({
      activeJobs: count(jobs.id),
      feesInProgress: sql<number>`coalesce(sum(${jobs.fee}::numeric), 0)`.mapWith(Number),
    }).from(jobs).where(and(eq(jobs.organisationId, organisationId), notInArray(jobs.stage, ["paid", "archived"])));
    const [visitSummary]=await tx.select({total:count()}).from(appointments).where(and(eq(appointments.organisationId,organisationId),eq(appointments.status,"confirmed"),gte(appointments.startsAt,localDayRange(weekStart).start),lt(appointments.startsAt,localDayRange(weekEnd).end)));
    const todayBounds=localDayRange(today);
    const todaysVisits=await tx.select({appointment:appointments,job:jobs,clientName:clients.displayName,address:properties.line1,city:properties.city,firstName:users.firstName,lastName:users.lastName}).from(appointments).innerJoin(jobs,and(eq(jobs.id,appointments.jobId),eq(jobs.organisationId,organisationId))).innerJoin(clients,eq(clients.id,jobs.clientId)).innerJoin(properties,eq(properties.id,jobs.propertyId)).leftJoin(users,eq(users.id,appointments.surveyorId)).where(and(eq(appointments.organisationId,organisationId),eq(appointments.status,"confirmed"),gte(appointments.startsAt,todayBounds.start),lt(appointments.startsAt,todayBounds.end))).orderBy(asc(appointments.startsAt));
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
      .where(and(eq(jobs.organisationId, organisationId), notInArray(jobs.stage, ["paid", "archived"])))
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
      inspectionsThisWeek: visitSummary?.total ?? 0,
      openClients: clientSummary?.openClients ?? 0,
      feesInProgress: jobSummary?.feesInProgress ?? 0,
      onboardingProgress: Math.min(100, Math.round(((onboardingSummary?.completed ?? 0) / 4) * 100)),
      workQueue: mappedJobs.slice(0, 4),
      inspectionsToday: todaysVisits.map(row=>({id:row.job.id,reference:row.job.reference,client:row.clientName,address:`${row.address}, ${row.city}`,service:row.job.serviceName,stage:row.job.stage,assignee:[row.firstName,row.lastName].filter(Boolean).join(" ")||"Unassigned",target:row.appointment.startsAt.toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit"}),fee:Number(row.job.fee??0),priority:row.job.priority==="high"?"High":"Normal"})),
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
    activeJobs: demoJobs.filter(job => !["paid", "archived"].includes(job.stage)).length,
    inspectionsThisWeek: demoJobs.filter(job => job.stage === "scheduled").length,
    openClients: demoClients.length,
    feesInProgress: demoJobs.filter(job => !["paid", "archived"].includes(job.stage)).reduce((total, job) => total + (job.fee ?? 0), 0),
    onboardingProgress: 0,
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
  const data = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const clientRows = await tx.select().from(clients).where(and(assignedClientScope(context), eq(clients.organisationId, context.organisationId), isNull(clients.archivedAt))).orderBy(asc(clients.displayName));
    const propertyRows = await tx.select({ clientId: properties.clientId, value: count(properties.id) }).from(properties).where(and(assignedPropertyScope(context), eq(properties.organisationId, context.organisationId), isNull(properties.archivedAt))).groupBy(properties.clientId);
    return { clientRows, propertyRows };
  });
  return data.clientRows.map((client) => ({ id: client.id, name: client.displayName, kind: client.kind === "company" ? "Company" : "Individual", email: client.email ?? "—", phone: client.phone ?? "—", properties: data.propertyRows.find((row) => row.clientId === client.id)?.value ?? 0, lastActivity: client.updatedAt.toLocaleDateString("en-GB"), version: client.version }));
}

export async function loadProperties(slug: string): Promise<Property[]> {
  if (!connected()) return demoProperties;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const data = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const propertyRows = await tx.select({ property: properties, clientName: clients.displayName }).from(properties).innerJoin(clients, eq(properties.clientId, clients.id)).where(and(assignedPropertyScope(context), eq(properties.organisationId, context.organisationId), isNull(properties.archivedAt))).orderBy(asc(properties.line1));
    const activeJobRows = await tx.select({ propertyId: jobs.propertyId, value: count(jobs.id) }).from(jobs).where(and(assignedJobScope(context), eq(jobs.organisationId, context.organisationId), notInArray(jobs.stage, ["paid", "archived"]))).groupBy(jobs.propertyId);
    return { propertyRows, activeJobRows };
  });
  return data.propertyRows.map(({ property, clientName }) => ({ id: property.id, address: property.line1, town: property.city, postcode: property.postcode, type: property.propertyType ?? "Not recorded", client: clientName, activeJobs: data.activeJobRows.find((row) => row.propertyId === property.id)?.value ?? 0, version: property.version }));
}

export async function loadPropertyWorkspace(slug: string, propertyId: string) {
  if (!connected()) {
    const property = demoProperties.find((item) => item.id === propertyId);
    if (!property) return null;
    const identityFixture = property.id === "prop_01" ? { country: "ENG" as const, latitude: 51.4589, longitude: -2.6202, locationConfidence: "approximate" as const, addressSource: "development_fixture", resolvedAt: null } : { country: null, latitude: null, longitude: null, locationConfidence: "unresolved" as const, addressSource: null, resolvedAt: null };
    return {
      property: { id: property.id, line1: property.address, line2: null, city: property.town, postcode: property.postcode, propertyType: property.type, version: property.version ?? 1, uprn: null, ...identityFixture },
      clientName: property.client,
      jobs: demoJobs.filter((job) => job.address.includes(property.address)).map((job) => ({ id: job.id, reference: job.reference, serviceName: job.service, stage: job.stage, targetDate: null })),
      events: [],
    };
  }
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [row] = await tx.select({ property: properties, clientName: clients.displayName }).from(properties).innerJoin(clients, eq(properties.clientId, clients.id)).where(and(eq(properties.id, propertyId), eq(properties.organisationId, context.organisationId), assignedPropertyScope(context))).limit(1);
    if (!row) return null;
    const [jobRows, eventRows] = await Promise.all([
      tx.select({ id: jobs.id, reference: jobs.reference, serviceName: jobs.serviceName, stage: jobs.stage, targetDate: jobs.targetDate }).from(jobs).where(and(eq(jobs.propertyId, propertyId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).orderBy(desc(jobs.updatedAt)),
      tx.select({ id: auditEvents.id, action: auditEvents.action, occurredAt: auditEvents.occurredAt, metadata: auditEvents.metadata }).from(auditEvents).where(and(eq(auditEvents.organisationId, context.organisationId), eq(auditEvents.resourceType, "property"), eq(auditEvents.resourceId, propertyId))).orderBy(desc(auditEvents.occurredAt)).limit(100),
    ]);
    return {
      property: { ...row.property, resolvedAt: row.property.resolvedAt?.toISOString() ?? null, createdAt: undefined, updatedAt: undefined, archivedAt: undefined, location: undefined, confirmedByUserId: undefined, organisationId: undefined, clientId: undefined },
      clientName: row.clientName,
      jobs: jobRows.map((job) => ({ ...job, targetDate: job.targetDate ? String(job.targetDate) : null })),
      events: eventRows.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    };
  });
}

export async function loadJobs(slug: string): Promise<Job[]> {
  if (!connected()) return demoJobs;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.select({ job: jobs, clientName: clients.displayName, address: properties.line1, city: properties.city, assigneeFirstName: users.firstName, assigneeLastName: users.lastName, assigneeEmail: users.email }).from(jobs).innerJoin(clients, eq(jobs.clientId, clients.id)).innerJoin(properties, eq(jobs.propertyId, properties.id)).leftJoin(users, eq(jobs.assignedSurveyorId, users.id)).where(and(assignedJobScope(context), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).orderBy(desc(jobs.updatedAt));
  });
  return rows.map(({ job, clientName, address, city, assigneeFirstName, assigneeLastName, assigneeEmail }) => ({ id: job.id, reference: job.reference, client: clientName, address: `${address}, ${city}`, service: job.serviceName, stage: job.stage, assignee: [assigneeFirstName, assigneeLastName].filter(Boolean).join(" ") || assigneeEmail || "Unassigned", target: formatTarget(job.targetDate), fee: context.userRole === "surveyor" ? undefined : Number(job.fee ?? 0), priority: job.priority === "high" ? "High" : "Normal", version: job.version }));
}

export async function loadMembers(slug: string): Promise<Member[]> {
  if (!connected()) return demoMembers;
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  const data = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const memberRows = await tx.select({ membership: organisationMemberships, user: users }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.active, true))).orderBy(asc(users.firstName));
    const assignedJobs = await tx.select({ assignedSurveyorId: jobs.assignedSurveyorId }).from(jobs).where(and(eq(jobs.organisationId, context.organisationId), notInArray(jobs.stage, ["paid", "archived"])));
    const pendingInvitations = await tx.select().from(invitations).where(and(eq(invitations.organisationId, context.organisationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date()))).orderBy(desc(invitations.createdAt));
    return { memberRows, assignedJobs, pendingInvitations };
  });
  const activeMembers: Member[] = data.memberRows.map(({ membership, user }) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    const jobCount = data.assignedJobs.filter((job) => job.assignedSurveyorId === user.id).length;
    return { id: membership.id, name, email: user.email, initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), role: membership.role, canRecordSurvey: membership.canRecordSurvey, canApproveReports: membership.canApproveReports, status: "Active", workload: `${jobCount} active ${jobCount === 1 ? "job" : "jobs"}` };
  });
  const invitedMembers: Member[] = data.pendingInvitations.map((invitation) => ({
    id: invitation.id,
    name: invitation.email,
    email: invitation.email,
    initials: invitation.email.slice(0, 2).toUpperCase(),
    role: invitation.role,
    status: "Invited",
    workload: `Expires ${invitation.expiresAt.toLocaleDateString("en-GB")}`,
  }));
  return [...activeMembers, ...invitedMembers];
}

export async function loadPendingSupportRequests(slug: string): Promise<SupportAccessRequest[]> {
  if (!connected()) return [];
  const context = await requireFirmAccess(slug);
  if (context.userRole !== "owner") return [];
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const rows = await tx.select({
      id: supportSessions.id,
      ticketReference: supportSessions.ticketReference,
      reason: supportSessions.reason,
      expiresAt: supportSessions.expiresAt,
      requestedAt: supportSessions.createdAt,
    }).from(supportSessions).where(and(
      eq(supportSessions.organisationId, context.organisationId),
      eq(supportSessions.permission, "write"),
      eq(supportSessions.breakGlass, false),
      isNull(supportSessions.approvedByUserId),
      isNull(supportSessions.revokedAt),
      gt(supportSessions.expiresAt, new Date()),
    )).orderBy(desc(supportSessions.createdAt));
    return rows.map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString(), requestedAt: row.requestedAt.toISOString() }));
  });
}

export async function loadJobFormOptions(slug: string): Promise<JobFormOptions> {
  if (!connected()) return {
    clients: demoClients.map((client) => ({ id: client.id, name: client.name })),
    properties: demoProperties.map((property) => ({ id: property.id, clientId: demoClients.find((client) => client.name === property.client)?.id ?? demoClients[0].id, label: `${property.address}, ${property.town}` })),
    surveyors: demoMembers.filter((member) => member.role === "owner" || member.role === "administrator" || member.role === "surveyor").map((member) => ({ id: member.id, name: member.name })),
    coordinators: demoMembers.filter((member) => member.role === "owner" || member.role === "administrator" || member.role === "coordinator").map((member) => ({ id: member.id, name: member.name })),
  };
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const clientRows = await tx.select({ id: clients.id, name: clients.displayName }).from(clients).where(and(assignedClientScope(context), eq(clients.organisationId, context.organisationId), isNull(clients.archivedAt))).orderBy(asc(clients.displayName));
    const propertyRows = await tx.select({ id: properties.id, clientId: properties.clientId, line1: properties.line1, city: properties.city, postcode: properties.postcode }).from(properties).where(and(assignedPropertyScope(context), eq(properties.organisationId, context.organisationId), isNull(properties.archivedAt))).orderBy(asc(properties.line1));
    const surveyorRows = await tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: organisationMemberships.role }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.active, true))).orderBy(asc(users.firstName));
    return {
      clients: clientRows,
      properties: propertyRows.map((property) => ({ id: property.id, clientId: property.clientId, label: `${property.line1}, ${property.city} · ${property.postcode}` })),
      surveyors: surveyorRows.filter((member) => member.role === "owner" || member.role === "administrator" || member.role === "surveyor").map((member) => ({ id: member.id, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email })),
      coordinators: surveyorRows.filter((member) => member.role === "owner" || member.role === "administrator" || member.role === "coordinator").map((member) => ({ id: member.id, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email })),
    };
  });
}

export async function loadOrganisationSettings(slug: string): Promise<OrganisationSettings> {
  if (!connected()) return {
    name: "North Star Surveying",
    region: "South West England",
    tradingName: "North Star Surveying",
    supportEmail: "hello@northstarsurveying.co.uk",
    accentColour: "#3b82f6",
    services: [{ id: "service-1", name: "Level 2 Home Survey", defaultFee: "895.00" }, { id: "service-2", name: "Level 3 Building Survey", defaultFee: "1295.00" }],
  };
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [organisation] = await tx.select({ name: organisations.name, region: organisations.region }).from(organisations).where(eq(organisations.id, context.organisationId)).limit(1);
    const [branding] = await tx.select().from(organisationBranding).where(eq(organisationBranding.organisationId, context.organisationId)).limit(1);
    const services = await tx.select({ id: serviceDefinitions.id, name: serviceDefinitions.name, defaultFee: serviceDefinitions.defaultFee }).from(serviceDefinitions).where(and(eq(serviceDefinitions.organisationId, context.organisationId), eq(serviceDefinitions.active, true))).orderBy(asc(serviceDefinitions.name));
    return {
      name: organisation.name,
      region: organisation.region,
      tradingName: branding?.tradingName ?? organisation.name,
      supportEmail: branding?.supportEmail ?? "",
      accentColour: branding?.accentColour ?? "#3b82f6",
      services: services.map((service) => ({ id: service.id, name: service.name, defaultFee: service.defaultFee ?? "" })),
    };
  });
}

export async function loadBillingSummary(slug: string): Promise<BillingSummary> {
  if (!connected()) return { configured: true, planKey: "practice", status: "trialing", seats: 5, activeMembers: 4, trialEndsAt: "2026-10-10T00:00:00.000Z", currentPeriodEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false };
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.organisationId, context.organisationId)).limit(1);
    const [members] = await tx.select({ count: count(organisationMemberships.id) }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.active, true)));
    return {
      configured: Boolean(subscription),
      planKey: subscription?.planKey ?? "practice",
      status: subscription?.status ?? "incomplete",
      seats: subscription?.seats ?? 1,
      activeMembers: members?.count ?? 0,
      trialEndsAt: subscription?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEndsAt: subscription?.currentPeriodEndsAt?.toISOString() ?? null,
      graceEndsAt: subscription?.graceEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    };
  });
}

export async function loadTenants(): Promise<Tenant[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return demoTenants;
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [rows, ownerRows, onboardingRows, activityRows] = await Promise.all([
    db.select({ organisation: organisations, subscription: subscriptions }).from(organisations).leftJoin(subscriptions, eq(subscriptions.organisationId, organisations.id)).orderBy(desc(organisations.createdAt)),
    db.select({ organisationId: organisationMemberships.organisationId, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(eq(organisationMemberships.role, "owner"), eq(organisationMemberships.active, true))),
    db.select({ organisationId: onboardingSteps.organisationId, completedAt: onboardingSteps.completedAt }).from(onboardingSteps),
    db.select({ organisationId: auditEvents.organisationId, occurredAt: auditEvents.occurredAt }).from(auditEvents).where(isNotNull(auditEvents.organisationId)).orderBy(desc(auditEvents.occurredAt)),
  ]);
  return rows.map(({ organisation, subscription }) => {
    const owner = ownerRows.find((row) => row.organisationId === organisation.id);
    const completed = onboardingRows.filter((row) => row.organisationId === organisation.id && row.completedAt).length;
    const lastAudit = activityRows.find((row) => row.organisationId === organisation.id)?.occurredAt;
    return {
      id: organisation.id,
      name: organisation.name,
      owner: owner ? [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email : "No owner assigned",
      plan: subscription?.planKey ?? "Pending",
      status: organisation.status,
      subscription: subscription?.status ?? "incomplete",
      seats: subscription?.seats ?? 1,
      trialEnds: subscription?.trialEndsAt?.toLocaleDateString("en-GB") ?? "—",
      onboarding: Math.min(100, Math.round((completed / 4) * 100)),
      usage: 0,
      lastActive: (lastAudit ?? organisation.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }),
    };
  });
}

export async function loadTenantDetail(tenantId: string): Promise<PlatformTenantDetail | null> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) {
    const tenant = demoTenants.find((item) => item.id === tenantId);
    if (!tenant) return null;
    return { tenant, region: "United Kingdom", practiceType: "multi-disciplinary", createdAt: "26 September 2026", branding: { tradingName: tenant.name, supportEmail: "", accentColour: "#3b82f6", logoUrl: null }, subscription: { status: tenant.subscription, planKey: tenant.plan, seats: tenant.seats, trialEndsAt: null, currentPeriodEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false }, members: demoMembers.map((member) => ({ id: member.id, name: member.name, email: member.email, role: member.role, active: member.status === "Active" })), invitations: [], usage: { clients: demoClients.length, properties: demoProperties.length, jobs: demoJobs.length, activeJobs: demoJobs.filter((job) => job.stage !== "paid" && job.stage !== "archived").length }, onboarding: [], audit: demoActivities.map((activity, index) => ({ id: String(index), action: activity.text, resourceType: "demo", occurredAt: activity.time, actor: "Demo operator" })) };
  }
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [record] = await db.select({ organisation: organisations, branding: organisationBranding, subscription: subscriptions }).from(organisations).leftJoin(organisationBranding, eq(organisationBranding.organisationId, organisations.id)).leftJoin(subscriptions, eq(subscriptions.organisationId, organisations.id)).where(eq(organisations.id, tenantId)).limit(1);
  if (!record) return null;
  const [memberRows, invitationRows, clientRows, propertyRows, jobRows, onboardingRows, auditRows] = await Promise.all([
    db.select({ id: organisationMemberships.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: organisationMemberships.role, active: organisationMemberships.active }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(eq(organisationMemberships.organisationId, tenantId)).orderBy(asc(users.firstName)),
    db.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt }).from(invitations).where(and(eq(invitations.organisationId, tenantId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date()))).orderBy(desc(invitations.createdAt)),
    db.select({ id: clients.id }).from(clients).where(eq(clients.organisationId, tenantId)),
    db.select({ id: properties.id }).from(properties).where(eq(properties.organisationId, tenantId)),
    db.select({ id: jobs.id, stage: jobs.stage }).from(jobs).where(eq(jobs.organisationId, tenantId)),
    db.select({ key: onboardingSteps.key, completedAt: onboardingSteps.completedAt }).from(onboardingSteps).where(eq(onboardingSteps.organisationId, tenantId)).orderBy(asc(onboardingSteps.key)),
    db.select({ id: auditEvents.id, action: auditEvents.action, resourceType: auditEvents.resourceType, occurredAt: auditEvents.occurredAt, actorUserId: auditEvents.actorUserId, platformStaffId: auditEvents.platformStaffId }).from(auditEvents).where(eq(auditEvents.organisationId, tenantId)).orderBy(desc(auditEvents.occurredAt)).limit(50),
  ]);
  const owner = memberRows.find((member) => member.role === "owner" && member.active);
  const completed = onboardingRows.filter((step) => step.completedAt).length;
  const tenant: Tenant = {
    id: record.organisation.id,
    name: record.organisation.name,
    owner: owner ? [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email : "No owner assigned",
    plan: record.subscription?.planKey ?? "Pending",
    status: record.organisation.status,
    subscription: record.subscription?.status ?? "incomplete",
    seats: record.subscription?.seats ?? 1,
    trialEnds: record.subscription?.trialEndsAt?.toLocaleDateString("en-GB") ?? "—",
    onboarding: Math.min(100, Math.round((completed / 4) * 100)),
    usage: jobRows.length,
    lastActive: (auditRows[0]?.occurredAt ?? record.organisation.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }),
  };
  return {
    tenant,
    region: record.organisation.region,
    practiceType: record.organisation.practiceType,
    createdAt: record.organisation.createdAt.toLocaleString("en-GB", { dateStyle: "long", timeZone: "Europe/London" }),
    branding: { tradingName: record.branding?.tradingName ?? record.organisation.name, supportEmail: record.branding?.supportEmail ?? "", accentColour: record.branding?.accentColour ?? "#3b82f6", logoUrl: record.branding?.logoUrl ?? null },
    subscription: record.subscription ? { status: record.subscription.status, planKey: record.subscription.planKey, seats: record.subscription.seats, trialEndsAt: record.subscription.trialEndsAt?.toISOString() ?? null, currentPeriodEndsAt: record.subscription.currentPeriodEndsAt?.toISOString() ?? null, graceEndsAt: record.subscription.graceEndsAt?.toISOString() ?? null, cancelAtPeriodEnd: record.subscription.cancelAtPeriodEnd } : null,
    members: memberRows.map((member) => ({ id: member.id, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email, email: member.email, role: member.role, active: member.active })),
    invitations: invitationRows.map((invitation) => ({ ...invitation, expiresAt: invitation.expiresAt.toISOString() })),
    usage: { clients: clientRows.length, properties: propertyRows.length, jobs: jobRows.length, activeJobs: jobRows.filter((job) => job.stage !== "paid" && job.stage !== "archived").length },
    onboarding: onboardingRows.map((step) => ({ key: step.key, completedAt: step.completedAt?.toISOString() ?? null })),
    audit: auditRows.map((event) => ({ id: event.id, action: event.action, resourceType: event.resourceType, occurredAt: event.occurredAt.toISOString(), actor: event.platformStaffId ? "Platform staff" : event.actorUserId ? "Firm user" : "System" })),
  };
}

export async function loadPlatformOnboardingQueue(): Promise<PlatformQueueRow[]> {
  const tenants = await loadTenants();
  return tenants.filter((tenant) => tenant.onboarding < 100 || tenant.status === "provisioning" || tenant.subscription === "incomplete").map((tenant) => ({ id: tenant.id, primary: tenant.name, secondary: tenant.owner, state: tenant.subscription === "incomplete" ? "Checkout incomplete" : `${tenant.onboarding}% complete`, detail: `${tenant.status} · Last activity ${tenant.lastActive}`, href: `/platform/tenants/${tenant.id}`, action: "Open tenant", tone: tenant.subscription === "incomplete" ? "amber" : "blue" }));
}

export async function loadPlatformBillingQueue(): Promise<PlatformQueueRow[]> {
  const tenants = await loadTenants();
  return tenants.filter((tenant) => tenant.subscription !== "active" && tenant.subscription !== "trialing").map((tenant) => ({ id: tenant.id, primary: tenant.name, secondary: `${tenant.plan} · ${tenant.seats} seats`, state: tenant.subscription.replace("_", " "), detail: tenant.subscription === "incomplete" ? "Billing setup has not completed" : tenant.trialEnds === "—" ? "No active trial" : `Trial ends ${tenant.trialEnds}`, href: `/platform/tenants/${tenant.id}`, action: "Inspect account", tone: tenant.subscription === "unpaid" ? "red" : tenant.subscription === "canceled" ? "slate" : "amber" }));
}

export async function loadPlatformIncidentQueue(): Promise<PlatformQueueRow[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return [];
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [failedJobs, failedWebhooks] = await Promise.all([
    db.select({ job: backgroundJobs, organisationName: organisations.name }).from(backgroundJobs).leftJoin(organisations, eq(backgroundJobs.organisationId, organisations.id)).where(eq(backgroundJobs.status, "failed")).orderBy(desc(backgroundJobs.failedAt)).limit(100),
    db.select().from(webhookEvents).where(and(isNotNull(webhookEvents.failedAt), isNull(webhookEvents.processedAt))).orderBy(desc(webhookEvents.failedAt)).limit(100),
  ]);
  return [
    ...failedJobs.map(({ job, organisationName }) => ({ id: job.id, primary: job.type.replaceAll("_", " "), secondary: organisationName ?? "Platform-wide", state: "Delivery failed", detail: `${job.attempts} attempts · ${job.error ?? "No error detail"}`, action: "Retry delivery", actionEndpoint: `/api/platform/background-jobs/${job.id}/retry`, tone: "red" as const })),
    ...failedWebhooks.map((event) => ({ id: event.id, primary: event.eventType, secondary: `${event.provider} webhook`, state: "Processing failed", detail: event.error ?? "No error detail", tone: "red" as const })),
  ];
}

export async function loadPlatformIncidents(): Promise<{ incidents: PlatformIncidentRecord[]; tenants: { id: string; name: string }[]; technicalFailures: PlatformQueueRow[] }> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return { incidents: [], tenants: [], technicalFailures: [] };
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [incidentRows, affectedRows, tenantRows, technicalFailures] = await Promise.all([
    db.select().from(platformIncidents).orderBy(desc(platformIncidents.startedAt)).limit(100),
    db.select({ incidentId: platformIncidentOrganisations.incidentId, organisationId: organisations.id, organisationName: organisations.name }).from(platformIncidentOrganisations).innerJoin(organisations, eq(platformIncidentOrganisations.organisationId, organisations.id)),
    db.select({ id: organisations.id, name: organisations.name }).from(organisations).orderBy(asc(organisations.name)),
    loadPlatformIncidentQueue(),
  ]);
  return {
    incidents: incidentRows.map((incident) => ({ id: incident.id, title: incident.title, summary: incident.summary, severity: incident.severity, status: incident.status, startedAt: incident.startedAt.toISOString(), resolvedAt: incident.resolvedAt?.toISOString() ?? null, affectedOrganisations: affectedRows.filter((row) => row.incidentId === incident.id).map((row) => ({ id: row.organisationId, name: row.organisationName })) })),
    tenants: tenantRows,
    technicalFailures,
  };
}

export async function loadPlatformStaff(): Promise<PlatformStaffRecord[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return [{ id: "00000000-0000-0000-0000-000000000001", clerkUserId: "demo_platform_user", name: "Surveynt Operator", email: "operator@surveynt.local", role: "super_admin", active: true, createdAt: new Date("2026-09-01T09:00:00.000Z").toISOString(), updatedAt: new Date("2026-09-01T09:00:00.000Z").toISOString() }];
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const rows = await db.select({ staff: platformStaff, email: users.email, firstName: users.firstName, lastName: users.lastName }).from(platformStaff).leftJoin(users, eq(users.clerkUserId, platformStaff.clerkUserId)).orderBy(desc(platformStaff.active), asc(users.firstName), asc(users.email));
  return rows.map(({ staff, email, firstName, lastName }) => ({
    id: staff.id,
    clerkUserId: staff.clerkUserId,
    name: [firstName, lastName].filter(Boolean).join(" ") || email || "Unsynchronised Clerk user",
    email: email ?? "Email not synchronised",
    role: staff.role,
    active: staff.active,
    createdAt: staff.createdAt.toISOString(),
    updatedAt: staff.updatedAt.toISOString(),
  }));
}

export async function loadPlatformUsageQueue(): Promise<PlatformQueueRow[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return [];
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [tenantRows, clientRows, propertyRows, jobRows, memberRows] = await Promise.all([
    db.select({ id: organisations.id, name: organisations.name }).from(organisations).orderBy(asc(organisations.name)),
    db.select({ organisationId: clients.organisationId }).from(clients),
    db.select({ organisationId: properties.organisationId }).from(properties),
    db.select({ organisationId: jobs.organisationId, stage: jobs.stage }).from(jobs),
    db.select({ organisationId: organisationMemberships.organisationId, active: organisationMemberships.active }).from(organisationMemberships),
  ]);
  return tenantRows.map((tenant) => {
    const jobCount = jobRows.filter((row) => row.organisationId === tenant.id).length;
    const activeJobs = jobRows.filter((row) => row.organisationId === tenant.id && row.stage !== "paid" && row.stage !== "archived").length;
    const memberCount = memberRows.filter((row) => row.organisationId === tenant.id && row.active).length;
    return { id: tenant.id, primary: tenant.name, secondary: `${memberCount} active ${memberCount === 1 ? "member" : "members"}`, state: `${activeJobs} active jobs`, detail: `${clientRows.filter((row) => row.organisationId === tenant.id).length} clients · ${propertyRows.filter((row) => row.organisationId === tenant.id).length} properties · ${jobCount} total jobs`, href: `/platform/tenants/${tenant.id}`, action: "Inspect usage", tone: activeJobs ? "blue" : "slate" };
  });
}

export async function loadPlatformSupportQueue(): Promise<PlatformQueueRow[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return [];
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const rows = await db.select({ session: supportSessions, organisationName: organisations.name }).from(supportSessions).innerJoin(organisations, eq(supportSessions.organisationId, organisations.id)).orderBy(desc(supportSessions.createdAt)).limit(100);
  const now = new Date();
  return rows.map(({ session, organisationName }) => {
    const active = !session.revokedAt && session.expiresAt > now;
    const awaiting = active && session.permission === "write" && !session.approvedByUserId && !session.breakGlass;
    const state = session.revokedAt ? "Revoked" : session.expiresAt <= now ? "Expired" : awaiting ? "Awaiting approval" : "Active";
    return { id: session.id, primary: session.ticketReference, secondary: organisationName, state, detail: `${session.breakGlass ? "Emergency write" : session.permission === "read" ? "Read-only" : "Write"} · Expires ${session.expiresAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" })}`, href: `/platform/tenants/${session.organisationId}`, action: "Open tenant", tone: active ? awaiting ? "amber" : "blue" : "slate" };
  });
}

export async function loadSupportSessionView(sessionId: string) {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return null;
  const operator = await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [record] = await db.select({ session: supportSessions, organisation: organisations }).from(supportSessions).innerJoin(organisations, eq(supportSessions.organisationId, organisations.id)).where(eq(supportSessions.id, sessionId)).limit(1);
  if (!record || record.session.revokedAt || record.session.expiresAt <= new Date()) return null;
  if (record.session.platformStaffId !== operator.platformStaffId && operator.role !== "super_admin") return null;
  if (record.session.permission !== "read" && !record.session.approvedByUserId && !record.session.breakGlass) return null;
  const [memberRows, clientRows, propertyRows, jobRows] = await Promise.all([
    db.select({ id: organisationMemberships.id, role: organisationMemberships.role, active: organisationMemberships.active, email: users.email, firstName: users.firstName, lastName: users.lastName }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(eq(organisationMemberships.organisationId, record.organisation.id)),
    db.select({ id: clients.id, displayName: clients.displayName, archivedAt: clients.archivedAt }).from(clients).where(eq(clients.organisationId, record.organisation.id)),
    db.select({ id: properties.id, archivedAt: properties.archivedAt }).from(properties).where(eq(properties.organisationId, record.organisation.id)),
    db.select({ id: jobs.id, reference: jobs.reference, stage: jobs.stage }).from(jobs).where(eq(jobs.organisationId, record.organisation.id)),
  ]);
  await db.insert(auditEvents).values({ organisationId: record.organisation.id, platformStaffId: operator.platformStaffId, supportSessionId: record.session.id, action: "support.tenant_summary_viewed", resourceType: "organisation", resourceId: record.organisation.id, metadata: { ticketReference: record.session.ticketReference, reason: record.session.reason } });
  return {
    session: { id: record.session.id, ticketReference: record.session.ticketReference, reason: record.session.reason, permission: record.session.permission, breakGlass: record.session.breakGlass, expiresAt: record.session.expiresAt.toISOString() },
    organisation: { id: record.organisation.id, name: record.organisation.name, status: record.organisation.status, practiceType: record.organisation.practiceType, region: record.organisation.region },
    members: memberRows,
    clients: clientRows,
    properties: propertyRows,
    jobs: jobRows,
  };
}

export async function loadPlatformPracticePackQueue(): Promise<PlatformQueueRow[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return [];
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [packs, versions] = await Promise.all([db.select().from(practicePacks).orderBy(asc(practicePacks.name)), db.select().from(practicePackVersions).orderBy(desc(practicePackVersions.createdAt))]);
  return packs.map((pack) => {
    const version = versions.find((item) => item.practicePackId === pack.id);
    return { id: pack.id, primary: pack.name, secondary: pack.discipline, state: pack.active ? version?.status ?? "No version" : "Inactive", detail: version ? `Version ${version.version}${version.publishedAt ? ` · Published ${version.publishedAt.toLocaleDateString("en-GB")}` : ""}` : "No version has been created", tone: pack.active && version?.status === "published" ? "green" : pack.active ? "amber" : "slate" };
  });
}

export async function loadPlatformPracticePacks(): Promise<PracticePackRecord[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return [];
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [packs, versions] = await Promise.all([db.select().from(practicePacks).orderBy(asc(practicePacks.name)), db.select().from(practicePackVersions).orderBy(desc(practicePackVersions.createdAt))]);
  return packs.map((pack) => ({
    id: pack.id,
    key: pack.key,
    name: pack.name,
    discipline: pack.discipline,
    active: pack.active,
    versions: versions.filter((version) => version.practicePackId === pack.id).map((version) => ({ id: version.id, version: version.version, status: version.status, definition: version.definition, publishedAt: version.publishedAt?.toISOString() ?? null, createdAt: version.createdAt.toISOString() })),
  }));
}

export async function loadPlatformAuditQueue(): Promise<PlatformQueueRow[]> {
  if (!process.env.DATABASE_ADMIN_URL || !isClerkConfigured()) return [];
  await requirePlatformAccess();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const rows = await db.select({ event: auditEvents, organisationName: organisations.name }).from(auditEvents).leftJoin(organisations, eq(auditEvents.organisationId, organisations.id)).orderBy(desc(auditEvents.occurredAt)).limit(100);
  return rows.map(({ event, organisationName }) => ({ id: event.id, primary: event.action, secondary: event.platformStaffId ? "Platform staff" : event.actorUserId ? "Firm user" : "System", state: "Recorded", detail: `${organisationName ?? "Platform-wide"} · ${event.resourceType} · ${event.occurredAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" })}`, href: event.organisationId ? `/platform/tenants/${event.organisationId}` : undefined, action: event.organisationId ? "Open tenant" : undefined, tone: event.platformStaffId ? "blue" : "green" }));
}
