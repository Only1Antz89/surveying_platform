import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  geometry,
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
import { sql } from "drizzle-orm";

const geometryFeature4326 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(Geometry,4326)";
  },
});

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
export const propertyCountry = pgEnum("property_country", ["ENG", "WLS", "SCT", "NIR"]);
export const locationConfidence = pgEnum("location_confidence", ["unresolved", "approximate", "confirmed", "exact"]);
export const enrichmentStatus = pgEnum("enrichment_status", ["queued", "running", "completed", "partial", "failed"]);
export const providerResultStatus = pgEnum("provider_result_status", ["matched", "no_match", "unsupported", "not_configured", "unavailable", "error"]);
export const informationClass = pgEnum("information_class", ["surveyor_verified", "authoritative_external", "indicative_external_context"]);
export const coverageStatus = pgEnum("coverage_status", ["covered", "partial", "outside_coverage", "unknown"]);
export const datasetSyncStatus = pgEnum("dataset_sync_status", ["queued", "downloading", "validating", "staged", "active", "failed", "rolled_back"]);

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
  country: propertyCountry("country"),
  uprn: text("uprn"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
  addressSource: text("address_source"),
  locationConfidence: locationConfidence("location_confidence").notNull().default("unresolved"),
  locationResolutionMethod: text("location_resolution_method"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("properties_org_idx").on(table.organisationId),
  index("properties_client_idx").on(table.clientId),
  index("properties_org_uprn_idx").on(table.organisationId, table.uprn),
  index("properties_location_gix").using("gist", table.location),
  check("properties_coordinates_pair_check", sql`(${table.latitude} is null and ${table.longitude} is null) or (${table.latitude} is not null and ${table.longitude} is not null)`),
  check("properties_latitude_check", sql`${table.latitude} is null or ${table.latitude} between -90 and 90`),
  check("properties_longitude_check", sql`${table.longitude} is null or ${table.longitude} between -180 and 180`),
  check("properties_uprn_check", sql`${table.uprn} is null or ${table.uprn} ~ '^[0-9]{1,12}$'`),
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

export const dataSources = pgTable("data_sources", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  organisation: text("organisation").notNull(),
  category: text("category").notNull(),
  documentationUrl: text("documentation_url").notNull(),
  accessUrl: text("access_url"),
  licence: text("licence").notNull(),
  licenceUrl: text("licence_url"),
  attribution: text("attribution").notNull(),
  coverageCountries: text("coverage_countries").array().notNull().default(sql`'{}'::text[]`),
  limitations: text("limitations"),
  accessRequirements: text("access_requirements"),
  enabled: boolean("enabled").notNull().default(false),
  refreshPolicy: text("refresh_policy"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  latestSuccessfulSyncAt: timestamp("latest_successful_sync_at", { withTimezone: true }),
  ...timestamps,
});

export const datasetVersions = pgTable("dataset_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().references(() => dataSources.key, { onDelete: "restrict" }),
  version: text("version").notNull(),
  checksum: text("checksum").notNull(),
  sourceUrl: text("source_url").notNull(),
  licenceSnapshot: jsonb("licence_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  recordCount: integer("record_count").notNull().default(0),
  validation: jsonb("validation").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(false),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("dataset_versions_source_version_uidx").on(table.sourceKey, table.version),
  index("dataset_versions_source_active_idx").on(table.sourceKey, table.active),
]);

export const datasetSyncs = pgTable("dataset_syncs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().references(() => dataSources.key, { onDelete: "restrict" }),
  datasetVersionId: uuid("dataset_version_id").references(() => datasetVersions.id, { onDelete: "set null" }),
  status: datasetSyncStatus("status").notNull().default("queued"),
  sourceUrl: text("source_url").notNull(),
  checksum: text("checksum"),
  recordCount: integer("record_count"),
  validation: jsonb("validation").$type<Record<string, unknown>>().notNull().default({}),
  safeError: text("safe_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("dataset_syncs_source_time_idx").on(table.sourceKey, table.createdAt)]);

export const osUprnPoints = pgTable("os_uprn_points", {
  datasetVersionId: uuid("dataset_version_id").notNull().references(() => datasetVersions.id, { onDelete: "cascade" }),
  uprn: text("uprn").notNull(),
  location: geometry("location", { type: "point", mode: "xy", srid: 4326 }).notNull(),
  sourceEasting: doublePrecision("source_easting"),
  sourceNorthing: doublePrecision("source_northing"),
}, (table) => [
  uniqueIndex("os_uprn_points_version_uprn_uidx").on(table.datasetVersionId, table.uprn),
  index("os_uprn_points_location_gix").using("gist", table.location),
  check("os_uprn_points_uprn_check", sql`${table.uprn} ~ '^[0-9]{1,12}$'`),
]);

export const spatialReferenceFeatures = pgTable("spatial_reference_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetVersionId: uuid("dataset_version_id").notNull().references(() => datasetVersions.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull().references(() => dataSources.key, { onDelete: "restrict" }),
  sourceRecordId: text("source_record_id").notNull(),
  name: text("name"),
  geometry: geometryFeature4326("geometry").notNull(),
  properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("spatial_reference_version_record_uidx").on(table.datasetVersionId, table.sourceRecordId),
  index("spatial_reference_source_idx").on(table.sourceKey),
  index("spatial_reference_geometry_gix").using("gist", table.geometry),
]);

export const enrichmentRuns = pgTable("enrichment_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "restrict" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: enrichmentStatus("status").notNull().default("queued"),
  providerStatuses: jsonb("provider_statuses").$type<Record<string, string>>().notNull().default({}),
  safeErrors: jsonb("safe_errors").$type<Record<string, string>>().notNull().default({}),
  propertyVersion: integer("property_version").notNull(),
  locationFingerprint: text("location_fingerprint").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("enrichment_runs_org_idempotency_uidx").on(table.organisationId, table.idempotencyKey),
  index("enrichment_runs_property_time_idx").on(table.propertyId, table.createdAt),
  index("enrichment_runs_org_status_idx").on(table.organisationId, table.status),
]);

export const propertyIntelligenceSnapshots = pgTable("property_intelligence_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "restrict" }),
  enrichmentRunId: uuid("enrichment_run_id").notNull().references(() => enrichmentRuns.id, { onDelete: "restrict" }),
  sourceKey: text("source_key").notNull().references(() => dataSources.key, { onDelete: "restrict" }),
  datasetVersion: text("dataset_version"),
  sourceRecordId: text("source_record_id"),
  category: text("category").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  evidence: jsonb("evidence").$type<Array<{ label: string; url: string }>>().notNull().default([]),
  matchMethod: text("match_method").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  confidence: doublePrecision("confidence").notNull(),
  informationClass: informationClass("information_class").notNull(),
  coverageStatus: coverageStatus("coverage_status").notNull(),
  resultStatus: providerResultStatus("result_status").notNull(),
  licenceSnapshot: jsonb("licence_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  attribution: text("attribution").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("property_intelligence_property_source_time_idx").on(table.propertyId, table.sourceKey, table.createdAt),
  index("property_intelligence_org_idx").on(table.organisationId),
  check("property_intelligence_confidence_check", sql`${table.confidence} between 0 and 1`),
]);
