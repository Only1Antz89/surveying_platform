import { and, asc, count, desc, eq, gt, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { auditEvents, createDatabase, clients, invitations, jobs, onboardingSteps, organisationBranding, organisationMemberships, organisations, properties, serviceDefinitions, subscriptions, users } from "@fieldnote/db";
import type { Client, Job, Member, Property, Tenant } from "./demo-data";
import { activities as demoActivities, clients as demoClients, jobs as demoJobs, members as demoMembers, properties as demoProperties, tenants as demoTenants } from "./demo-data";
import { isClerkConfigured, requireFirmAccess, requirePlatformAccess } from "./access";

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
    }).from(jobs).where(and(eq(jobs.organisationId, organisationId), notInArray(jobs.stage, ["paid", "archived"])));
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
    return { id: membership.id, name, email: user.email, initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), role: membership.role, status: "Active", workload: `${jobCount} active ${jobCount === 1 ? "job" : "jobs"}` };
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

export async function loadJobFormOptions(slug: string): Promise<JobFormOptions> {
  if (!connected()) return {
    clients: demoClients.map((client) => ({ id: client.id, name: client.name })),
    properties: demoProperties.map((property) => ({ id: property.id, clientId: demoClients.find((client) => client.name === property.client)?.id ?? demoClients[0].id, label: `${property.address}, ${property.town}` })),
    surveyors: demoMembers.filter((member) => member.role === "owner" || member.role === "administrator" || member.role === "surveyor").map((member) => ({ id: member.id, name: member.name })),
  };
  const context = await requireFirmAccess(slug);
  const db = createDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    const clientRows = await tx.select({ id: clients.id, name: clients.displayName }).from(clients).where(and(eq(clients.organisationId, context.organisationId), isNull(clients.archivedAt))).orderBy(asc(clients.displayName));
    const propertyRows = await tx.select({ id: properties.id, clientId: properties.clientId, line1: properties.line1, city: properties.city, postcode: properties.postcode }).from(properties).where(and(eq(properties.organisationId, context.organisationId), isNull(properties.archivedAt))).orderBy(asc(properties.line1));
    const surveyorRows = await tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: organisationMemberships.role }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.active, true))).orderBy(asc(users.firstName));
    return {
      clients: clientRows,
      properties: propertyRows.map((property) => ({ id: property.id, clientId: property.clientId, label: `${property.line1}, ${property.city} · ${property.postcode}` })),
      surveyors: surveyorRows.filter((member) => member.role === "owner" || member.role === "administrator" || member.role === "surveyor").map((member) => ({ id: member.id, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email })),
    };
  });
}

export async function loadOrganisationSettings(slug: string): Promise<OrganisationSettings> {
  if (!connected()) return {
    name: "North Star Surveying",
    region: "South West England",
    tradingName: "North Star Surveying",
    supportEmail: "hello@northstarsurveying.co.uk",
    accentColour: "#2563eb",
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
      accentColour: branding?.accentColour ?? "#2563eb",
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
    return { tenant, region: "United Kingdom", practiceType: "multi-disciplinary", createdAt: "26 September 2026", branding: { tradingName: tenant.name, supportEmail: "", accentColour: "#2563eb", logoUrl: null }, subscription: { status: tenant.subscription, planKey: tenant.plan, seats: tenant.seats, trialEndsAt: null, currentPeriodEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false }, members: demoMembers.map((member) => ({ id: member.id, name: member.name, email: member.email, role: member.role, active: member.status === "Active" })), invitations: [], usage: { clients: demoClients.length, properties: demoProperties.length, jobs: demoJobs.length, activeJobs: demoJobs.filter((job) => job.stage !== "paid" && job.stage !== "archived").length }, onboarding: [], audit: demoActivities.map((activity, index) => ({ id: String(index), action: activity.text, resourceType: "demo", occurredAt: activity.time, actor: "Demo operator" })) };
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
    branding: { tradingName: record.branding?.tradingName ?? record.organisation.name, supportEmail: record.branding?.supportEmail ?? "", accentColour: record.branding?.accentColour ?? "#2563eb", logoUrl: record.branding?.logoUrl ?? null },
    subscription: record.subscription ? { status: record.subscription.status, planKey: record.subscription.planKey, seats: record.subscription.seats, trialEndsAt: record.subscription.trialEndsAt?.toISOString() ?? null, currentPeriodEndsAt: record.subscription.currentPeriodEndsAt?.toISOString() ?? null, graceEndsAt: record.subscription.graceEndsAt?.toISOString() ?? null, cancelAtPeriodEnd: record.subscription.cancelAtPeriodEnd } : null,
    members: memberRows.map((member) => ({ id: member.id, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email, email: member.email, role: member.role, active: member.active })),
    invitations: invitationRows.map((invitation) => ({ ...invitation, expiresAt: invitation.expiresAt.toISOString() })),
    usage: { clients: clientRows.length, properties: propertyRows.length, jobs: jobRows.length, activeJobs: jobRows.filter((job) => job.stage !== "paid" && job.stage !== "archived").length },
    onboarding: onboardingRows.map((step) => ({ key: step.key, completedAt: step.completedAt?.toISOString() ?? null })),
    audit: auditRows.map((event) => ({ id: event.id, action: event.action, resourceType: event.resourceType, occurredAt: event.occurredAt.toISOString(), actor: event.platformStaffId ? "Platform staff" : event.actorUserId ? "Firm user" : "System" })),
  };
}
