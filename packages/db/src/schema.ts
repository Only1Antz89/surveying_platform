import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organisationStatus = pgEnum("organisation_status", ["provisioning", "active", "suspended", "closed"]);
export const subscriptionStatus = pgEnum("subscription_status", ["incomplete", "trialing", "active", "past_due", "unpaid", "canceled"]);
export const organisationRole = pgEnum("organisation_role", ["owner", "administrator", "surveyor", "coordinator", "finance", "read_only"]);
export const platformRole = pgEnum("platform_role", ["super_admin", "support", "billing", "compliance"]);
export const jobStage = pgEnum("job_stage", ["enquiry", "quoted", "instructed", "scheduled", "inspection_complete", "report_drafting", "internal_review", "issued", "paid", "archived"]);
export const supportPermission = pgEnum("support_permission", ["read", "write"]);
export const incidentSeverity = pgEnum("incident_severity", ["low", "medium", "high", "critical"]);
export const incidentStatus = pgEnum("incident_status", ["investigating", "monitoring", "resolved"]);

export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrganisationId: text("clerk_organisation_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  practiceType: text("practice_type").notNull(),
  region: text("region").notNull(),
  status: organisationStatus("status").notNull().default("provisioning"),
  suspendedReason: text("suspended_reason"),
  ...timestamps,
}, (table) => [index("organisations_status_idx").on(table.status)]);

export const organisationBranding = pgTable("organisation_branding", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url"),
  accentColour: text("accent_colour").notNull().default("#3b82f6"),
  tradingName: text("trading_name"),
  supportEmail: text("support_email"),
  ...timestamps,
}, (table) => [uniqueIndex("organisation_branding_org_uidx").on(table.organisationId)]);

export const organisationDomains = pgTable("organisation_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull().unique(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  primary: boolean("primary").notNull().default(false),
  ...timestamps,
}, (table) => [index("organisation_domains_org_idx").on(table.organisationId)]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
  ...timestamps,
});

export const organisationMemberships = pgTable("organisation_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: organisationRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("organisation_membership_uidx").on(table.organisationId, table.userId),
  index("organisation_memberships_org_idx").on(table.organisationId),
  index("organisation_memberships_user_idx").on(table.userId),
]);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  clerkInvitationId: text("clerk_invitation_id").unique(),
  email: text("email").notNull(),
  role: organisationRole("role").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("invitations_org_idx").on(table.organisationId)]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  status: subscriptionStatus("status").notNull().default("incomplete"),
  planKey: text("plan_key").notNull().default("practice"),
  seats: integer("seats").notNull().default(1),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
  graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex("subscriptions_org_uidx").on(table.organisationId),
  index("subscriptions_status_idx").on(table.status),
]);

export const subscriptionEvents = pgTable("subscription_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  stripeEventId: text("stripe_event_id").unique(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("subscription_events_org_idx").on(table.organisationId), index("subscription_events_subscription_idx").on(table.subscriptionId)]);

export const entitlements = pgTable("entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  limit: integer("limit"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("entitlements_org_key_uidx").on(table.organisationId, table.key)]);

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("clients_org_idx").on(table.organisationId),
  index("clients_org_name_idx").on(table.organisationId, table.displayName),
]);

export const clientContacts = pgTable("client_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  preferredChannel: text("preferred_channel").notNull().default("email"),
  primary: boolean("primary").notNull().default(false),
  ...timestamps,
}, (table) => [index("client_contacts_org_idx").on(table.organisationId), index("client_contacts_client_idx").on(table.clientId)]);

export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  line1: text("line_1").notNull(),
  line2: text("line_2"),
  city: text("city").notNull(),
  postcode: text("postcode").notNull(),
  propertyType: text("property_type"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("properties_org_idx").on(table.organisationId),
  index("properties_client_idx").on(table.clientId),
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "restrict" }),
  reference: text("reference").notNull(),
  serviceName: text("service_name").notNull(),
  stage: jobStage("stage").notNull().default("enquiry"),
  priority: text("priority").notNull().default("normal"),
  assignedSurveyorId: uuid("assigned_surveyor_id").references(() => users.id, { onDelete: "set null" }),
  targetDate: date("target_date"),
  fee: numeric("fee", { precision: 12, scale: 2 }),
  notes: text("notes"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("jobs_org_reference_uidx").on(table.organisationId, table.reference),
  index("jobs_org_stage_idx").on(table.organisationId, table.stage),
  index("jobs_client_idx").on(table.clientId),
  index("jobs_property_idx").on(table.propertyId),
  index("jobs_assignee_idx").on(table.assignedSurveyorId),
]);

export const jobStageEvents = pgTable("job_stage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "restrict" }),
  fromStage: jobStage("from_stage"),
  toStage: jobStage("to_stage").notNull(),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("job_stage_events_job_idx").on(table.jobId), index("job_stage_events_org_idx").on(table.organisationId)]);

export const jobAssignments = pgTable("job_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  responsibility: text("responsibility").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("job_assignments_job_user_role_uidx").on(table.jobId, table.userId, table.responsibility), index("job_assignments_org_idx").on(table.organisationId), index("job_assignments_user_idx").on(table.userId)]);

export const serviceDefinitions = pgTable("service_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  defaultFee: numeric("default_fee", { precision: 12, scale: 2 }),
  active: boolean("active").notNull().default(true),
  ...timestamps,
}, (table) => [index("service_definitions_org_idx").on(table.organisationId)]);

export const practicePacks = pgTable("practice_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  discipline: text("discipline").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const practicePackVersions = pgTable("practice_pack_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  practicePackId: uuid("practice_pack_id").notNull().references(() => practicePacks.id, { onDelete: "restrict" }),
  version: text("version").notNull(),
  status: text("status").notNull().default("draft"),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("practice_pack_versions_uidx").on(table.practicePackId, table.version), index("practice_pack_versions_pack_idx").on(table.practicePackId)]);

export const onboardingSteps = pgTable("onboarding_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByUserId: uuid("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [uniqueIndex("onboarding_steps_org_key_uidx").on(table.organisationId, table.key)]);

export const platformStaff = pgTable("platform_staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  role: platformRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const platformIncidents = pgTable("platform_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  severity: incidentSeverity("severity").notNull(),
  status: incidentStatus("status").notNull().default("investigating"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdByStaffId: uuid("created_by_staff_id").references(() => platformStaff.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [index("platform_incidents_status_idx").on(table.status), index("platform_incidents_severity_idx").on(table.severity)]);

export const platformIncidentOrganisations = pgTable("platform_incident_organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id").notNull().references(() => platformIncidents.id, { onDelete: "cascade" }),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("platform_incident_org_uidx").on(table.incidentId, table.organisationId), index("platform_incident_org_org_idx").on(table.organisationId)]);

export const supportSessions = pgTable("support_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  platformStaffId: uuid("platform_staff_id").notNull().references(() => platformStaff.id, { onDelete: "restrict" }),
  ticketReference: text("ticket_reference").notNull(),
  reason: text("reason").notNull(),
  permission: supportPermission("permission").notNull().default("read"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  breakGlass: boolean("break_glass").notNull().default(false),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("support_sessions_org_idx").on(table.organisationId), index("support_sessions_staff_idx").on(table.platformStaffId)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "restrict" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  platformStaffId: uuid("platform_staff_id").references(() => platformStaff.id, { onDelete: "set null" }),
  supportSessionId: uuid("support_session_id").references(() => supportSessions.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  requestId: text("request_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_events_org_time_idx").on(table.organisationId, table.occurredAt), index("audit_events_action_idx").on(table.action)]);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("webhook_provider_event_uidx").on(table.provider, table.providerEventId)]);

export const backgroundJobs = pgTable("background_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "restrict" }),
  queue: text("queue").notNull(),
  type: text("type").notNull(),
  deduplicationKey: text("deduplication_key").unique(),
  providerMessageId: text("provider_message_id").unique(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  error: text("error"),
  ...timestamps,
}, (table) => [index("background_jobs_org_idx").on(table.organisationId), index("background_jobs_queue_status_idx").on(table.queue, table.status)]);
