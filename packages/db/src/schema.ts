import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  geometry,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
export const ukCountry = pgEnum("uk_country", ["ENG", "WLS", "SCT", "NIR"]);
export const locationConfidence = pgEnum("location_confidence", ["unresolved", "postcode_centroid", "geocoded_address", "surveyor_confirmed"]);
export const addressSource = pgEnum("address_source", ["manual", "postcodes_io", "nominatim"]);
export const inspectionStatus = pgEnum("inspection_status", ["inspected", "partially_inspected", "not_inspected", "inaccessible", "not_applicable"]);
export const surveyStatus = pgEnum("survey_status", ["in_progress", "in_review", "approved", "issued", "withdrawn"]);
export const observationKind = pgEnum("observation_kind", ["current_observation", "measurement", "client_claim", "historical_reference", "external_record"]);
export const observationStatus = pgEnum("observation_status", ["recorded", "superseded", "withdrawn"]);
export const valueOrigin = pgEnum("value_origin", ["surveyor_entry", "accepted_proposal", "edited_proposal", "clerical_prefill"]);
export const mediaKind = pgEnum("media_kind", ["photo", "document"]);

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
  // Identity (P1). Nullable so existing and manually entered records stay valid.
  // UPRN is an external identifier, never a uniqueness key: firms may hold the
  // same physical property independently.
  country: ukCountry("country"),
  uprn: text("uprn"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  location: geometry("location", { type: "point", mode: "xy", srid: 4326 }).generatedAlwaysAs(sql`case when latitude is not null and longitude is not null then st_setsrid(st_makepoint(longitude, latitude), 4326) end`),
  addressSource: addressSource("address_source").notNull().default("manual"),
  locationConfidence: locationConfidence("location_confidence").notNull().default("unresolved"),
  locationResolutionMethod: text("location_resolution_method"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  uprnConfirmedAt: timestamp("uprn_confirmed_at", { withTimezone: true }),
  uprnEvidenceType: text("uprn_evidence_type"),
  identityAddressFingerprint: text("identity_address_fingerprint"),
  ...timestamps,
}, (table) => [
  index("properties_org_idx").on(table.organisationId),
  index("properties_client_idx").on(table.clientId),
  unique("properties_org_id_uidx").on(table.organisationId, table.id),
  index("properties_org_uprn_idx").on(table.organisationId, table.uprn),
  index("properties_location_gix").using("gist", table.location),
  check("properties_coordinates_pair_chk", sql`(latitude is null) = (longitude is null)`),
  check("properties_coordinates_uk_chk", sql`latitude is null or (latitude between 49.85 and 60.95 and longitude between -8.75 and 1.8)`),
  check("properties_uprn_format_chk", sql`uprn is null or uprn ~ '^[0-9]{1,12}$'`),
  check("properties_location_confidence_chk", sql`(latitude is null) = (location_confidence = 'unresolved')`),
  check("properties_uprn_confirmation_chk", sql`uprn is null or (uprn_confirmed_at is not null and uprn_evidence_type is not null)`),
]);

/** Append-only history of identity resolutions and confirmations, with the evidence shown at the time. */
export const propertyIdentityEvents = pgTable("property_identity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  previous: jsonb("previous").$type<Record<string, unknown>>().notNull().default({}),
  next: jsonb("next").$type<Record<string, unknown>>().notNull().default({}),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "property_identity_events_property_fk", columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }).onDelete("restrict"),
  index("property_identity_events_property_idx").on(table.propertyId, table.createdAt),
  index("property_identity_events_org_idx").on(table.organisationId),
]);

/** Tenant-scoped record of submitted address searches. Doubles as the tenant cache required for submitted address text. */
export const addressLookups = pgTable("address_lookups", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  queryHash: text("query_hash").notNull(),
  status: text("status").notNull(),
  results: jsonb("results").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("address_lookups_cache_idx").on(table.organisationId, table.provider, table.queryHash, table.createdAt),
  index("address_lookups_expiry_idx").on(table.expiresAt),
]);

/** Deployment-wide request spacing for providers with usage policies (for example Nominatim). Holds no tenant data. */
export const providerRateLimits = pgTable("provider_rate_limits", {
  key: text("key").primaryKey(),
  nextAvailableAt: timestamp("next_available_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Global cache for public-source responses only. Keys are hashes; rows carry no tenant identifiers or address text. */
export const providerResponseCache = pgTable("provider_response_cache", {
  cacheKey: text("cache_key").primaryKey(),
  sourceKey: text("source_key").notNull(),
  datasetVersion: text("dataset_version"),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("provider_response_cache_expiry_idx").on(table.expiresAt), index("provider_response_cache_source_idx").on(table.sourceKey)]);

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
  unique("jobs_org_id_uidx").on(table.organisationId, table.id),
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
  /** Lease for a claimed job; an expired lease lets another worker reclaim it after a crash. */
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  error: text("error"),
  ...timestamps,
}, (table) => [index("background_jobs_org_idx").on(table.organisationId), index("background_jobs_queue_status_idx").on(table.queue, table.status)]);

// Global reference data. Readable by the tenant runtime through the
// surveynt_reference_read group role; writable only by importers
// (surveynt_reference_write) and the owner. See docs/property-intelligence.
export const referenceSchema = pgSchema("reference");

/** Any PostGIS geometry type in WGS84 (drizzle's built-in geometry type is point-only). Values are read as GeoJSON via SQL. */
const anyGeometry = customType<{ data: string; driverData: string }>({ dataType: () => "geometry(Geometry, 4326)" });

export const dataSources = referenceSchema.table("data_sources", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  organisation: text("organisation").notNull(),
  category: text("category").notNull(),
  documentationUrl: text("documentation_url").notNull(),
  accessMethod: text("access_method").notNull(),
  coverage: text("coverage").array().notNull().default(sql`'{}'::text[]`),
  licence: jsonb("licence").$type<Record<string, unknown>>().notNull(),
  registerStatus: text("register_status").notNull(),
  checkedAt: date("checked_at"),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  // Operator-controlled. A source runs only when enabled and verified.
  enabled: boolean("enabled").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
  verificationNotes: text("verification_notes"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastFailureCode: text("last_failure_code"),
  // Operations (P5): the last health probe and the last check of the publisher's release page.
  lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
  lastProbeStatus: text("last_probe_status"),
  lastProbeMessage: text("last_probe_message"),
  lastReleaseCheckAt: timestamp("last_release_check_at", { withTimezone: true }),
  lastReleaseCheckBy: text("last_release_check_by"),
  lastReleaseCheckNote: text("last_release_check_note"),
  ...timestamps,
});

/** One row per import attempt. Exactly one active version per source; earlier versions are kept for rollback. */
export const datasetSyncs = referenceSchema.table("dataset_syncs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().references(() => dataSources.key, { onDelete: "restrict" }),
  /** Layer within a multi-layer source (for example a heritage designation type). Empty for single-layer sources. */
  layer: text("layer").notNull().default(""),
  datasetVersion: text("dataset_version").notNull(),
  sourceUrl: text("source_url"),
  checksum: text("checksum"),
  licence: jsonb("licence").$type<Record<string, unknown>>().notNull().default({}),
  sourceCrs: text("source_crs"),
  extent: text("extent"),
  status: text("status").notNull().default("staging"),
  recordCount: integer("record_count").notNull().default(0),
  validation: jsonb("validation").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  previousActiveId: uuid("previous_active_id"),
  importedBy: text("imported_by"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("dataset_syncs_one_active_layer_uidx").on(table.sourceKey, table.layer).where(sql`status = 'active'`),
  index("dataset_syncs_source_idx").on(table.sourceKey, table.startedAt),
  check("dataset_syncs_status_chk", sql`status in ('staging', 'active', 'retired', 'failed')`),
]);

export const osOpenUprn = referenceSchema.table("os_open_uprn", {
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => datasetSyncs.id, { onDelete: "cascade" }),
  uprn: text("uprn").notNull(),
  geom: geometry("geom", { type: "point", mode: "xy", srid: 4326 }).notNull(),
  sourceX: doublePrecision("source_x"),
  sourceY: doublePrecision("source_y"),
}, (table) => [
  primaryKey({ name: "os_open_uprn_pk", columns: [table.datasetSyncId, table.uprn] }),
  index("os_open_uprn_geog_gix").using("gist", sql`(${table.geom}::geography)`),
  check("os_open_uprn_format_chk", sql`uprn ~ '^[0-9]{1,12}$'`),
]);

// Survey capture (A1). Every table is tenant-scoped with RLS and composite
// foreign keys so a child row can never point at another firm's record.

/** One inspection record for a job, pinned to the exact form template it was captured against. */
export const surveys = pgTable("surveys", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(),
  propertyId: uuid("property_id").notNull(),
  templateKey: text("template_key").notNull(),
  templateVersion: text("template_version").notNull(),
  templateFingerprint: text("template_fingerprint").notNull(),
  serviceLevel: text("service_level").notNull(),
  jurisdiction: ukCountry("jurisdiction").notNull(),
  status: surveyStatus("status").notNull().default("in_progress"),
  clientGeneratedId: text("client_generated_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  unique("surveys_org_id_uidx").on(table.organisationId, table.id),
  foreignKey({ name: "surveys_job_fk", columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }).onDelete("restrict"),
  foreignKey({ name: "surveys_property_fk", columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }).onDelete("restrict"),
  uniqueIndex("surveys_active_job_uidx").on(table.organisationId, table.jobId).where(sql`status <> 'withdrawn'`),
  uniqueIndex("surveys_client_id_uidx").on(table.organisationId, table.clientGeneratedId),
  index("surveys_property_idx").on(table.organisationId, table.propertyId),
  check("surveys_service_level_chk", sql`service_level in ('level_1', 'level_2', 'level_3', 'bespoke')`),
]);

export const surveyElements = pgTable("survey_elements", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  sectionKey: text("section_key").notNull(),
  elementKey: text("element_key").notNull(),
  locationLabel: text("location_label").notNull().default(""),
  inspectionStatus: inspectionStatus("inspection_status"),
  limitationReason: text("limitation_reason"),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  unique("survey_elements_org_id_uidx").on(table.organisationId, table.id),
  foreignKey({ name: "survey_elements_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  uniqueIndex("survey_elements_location_uidx").on(table.surveyId, table.sectionKey, table.elementKey, table.locationLabel),
]);

/**
 * Append-only field value history. A change inserts a new row that supersedes
 * the previous one; the current value is the row with superseded_at null.
 */
export const surveyFieldValues = pgTable("survey_field_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  fieldPath: text("field_path").notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  origin: valueOrigin("origin").notNull().default("surveyor_entry"),
  sourceKind: text("source_kind").notNull().default("manual"),
  sourceRef: text("source_ref"),
  sourceEventDate: date("source_event_date"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  supersedesId: uuid("supersedes_id"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  correctionReason: text("correction_reason"),
  clientGeneratedId: text("client_generated_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "survey_field_values_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  uniqueIndex("survey_field_values_current_uidx").on(table.surveyId, table.fieldPath).where(sql`superseded_at is null`),
  uniqueIndex("survey_field_values_client_id_uidx").on(table.organisationId, table.clientGeneratedId),
  index("survey_field_values_history_idx").on(table.surveyId, table.fieldPath, table.createdAt),
  check("survey_field_values_path_chk", sql`field_path ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$'`),
]);

export const observations = pgTable("observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  elementId: uuid("element_id"),
  kind: observationKind("kind").notNull(),
  text: text("text").notNull(),
  structured: jsonb("structured").$type<Record<string, unknown>>().notNull().default({}),
  locationLabel: text("location_label"),
  status: observationStatus("status").notNull().default("recorded"),
  origin: valueOrigin("origin").notNull().default("surveyor_entry"),
  sourceKind: text("source_kind").notNull().default("manual"),
  sourceRef: text("source_ref"),
  sourceEventDate: date("source_event_date"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  supersedesId: uuid("supersedes_id"),
  clientGeneratedId: text("client_generated_id").notNull(),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  unique("observations_org_id_uidx").on(table.organisationId, table.id),
  foreignKey({ name: "observations_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  foreignKey({ name: "observations_element_fk", columns: [table.organisationId, table.elementId], foreignColumns: [surveyElements.organisationId, surveyElements.id] }).onDelete("restrict"),
  uniqueIndex("observations_client_id_uidx").on(table.organisationId, table.clientGeneratedId),
  index("observations_survey_idx").on(table.surveyId, table.status),
]);

/** Original files are immutable. Annotated, thumbnail or redacted versions are separate rows derived from the original. */
export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull(),
  surveyId: uuid("survey_id"),
  kind: mediaKind("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  width: integer("width"),
  height: integer("height"),
  originalFilename: text("original_filename"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  captureContext: jsonb("capture_context").$type<Record<string, unknown>>().notNull().default({}),
  derivedFromId: uuid("derived_from_id"),
  derivation: text("derivation").notNull().default("original"),
  status: text("status").notNull().default("stored"),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  clientGeneratedId: text("client_generated_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("media_assets_org_id_uidx").on(table.organisationId, table.id),
  foreignKey({ name: "media_assets_property_fk", columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }).onDelete("restrict"),
  foreignKey({ name: "media_assets_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  foreignKey({ name: "media_assets_derived_fk", columns: [table.organisationId, table.derivedFromId], foreignColumns: [table.organisationId, table.id] }).onDelete("restrict"),
  uniqueIndex("media_assets_client_id_uidx").on(table.organisationId, table.clientGeneratedId),
  index("media_assets_survey_idx").on(table.surveyId),
  check("media_assets_derivation_chk", sql`derivation in ('original', 'annotated', 'thumbnail', 'redacted', 'processed') and ((derivation = 'original') = (derived_from_id is null))`),
  check("media_assets_status_chk", sql`status in ('stored', 'deleted')`),
]);

/** Explicit links between a finding (field value, observation or element) and the evidence that supports it. */
export const evidenceLinks = pgTable("evidence_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  evidenceType: text("evidence_type").notNull(),
  evidenceId: text("evidence_id").notNull(),
  region: jsonb("region").$type<Record<string, unknown>>(),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  clientGeneratedId: text("client_generated_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "evidence_links_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  uniqueIndex("evidence_links_client_id_uidx").on(table.organisationId, table.clientGeneratedId),
  index("evidence_links_target_idx").on(table.surveyId, table.targetType, table.targetId),
  check("evidence_links_target_chk", sql`target_type in ('field_value', 'observation', 'element')`),
  check("evidence_links_evidence_chk", sql`evidence_type in ('media', 'observation', 'intelligence_snapshot', 'document_span', 'prior_survey', 'external_record')`),
]);

/** Persistent assistant work list per survey. Deduplicated so re-running derivation never duplicates tasks. */
export const assistantTasks = pgTable("assistant_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("open"),
  dedupeKey: text("dedupe_key").notNull(),
  fieldPath: text("field_path"),
  elementKey: text("element_key"),
  title: text("title").notNull(),
  detail: text("detail"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  inputVersion: text("input_version"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolutionNote: text("resolution_note"),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "assistant_tasks_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  uniqueIndex("assistant_tasks_dedupe_uidx").on(table.surveyId, table.dedupeKey),
  index("assistant_tasks_open_idx").on(table.surveyId, table.status),
  check("assistant_tasks_status_chk", sql`status in ('open', 'resolved', 'dismissed')`),
  check("assistant_tasks_kind_chk", sql`kind in ('missing_field', 'pending_verification', 'discrepancy', 'reinspect', 'limitation_required', 'draft_section', 'review_ai_text')`),
]);

/** Idempotency ledger for offline sync. Replaying an operation returns its stored result instead of applying it twice. */
export const syncOperations = pgTable("sync_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  operationId: text("operation_id").notNull(),
  operationType: text("operation_type").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  appliedByUserId: uuid("applied_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "sync_operations_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  uniqueIndex("sync_operations_operation_uidx").on(table.organisationId, table.operationId),
]);

/**
 * Generic versioned spatial reference layer (points, lines or polygons) for
 * bulk-imported open datasets. Only rows of active syncs are ever queried.
 */
export const spatialFeatures = referenceSchema.table("spatial_features", {
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => datasetSyncs.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  layer: text("layer").notNull(),
  featureId: text("feature_id").notNull(),
  name: text("name"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  geom: anyGeometry("geom").notNull(),
}, (table) => [
  primaryKey({ name: "spatial_features_pk", columns: [table.datasetSyncId, table.featureId] }),
  index("spatial_features_gix").using("gist", table.geom),
  index("spatial_features_layer_idx").on(table.sourceKey, table.layer),
]);

// Property history (P4). HM Land Registry Price Paid Data and the published
// transaction-to-UPRN look-up. Only the fields needed for a sales history are
// kept: no Price Paid address field is ever stored.

/** One Price Paid transaction per dataset version. Corrections (C) and deletions (D) are applied by transaction id. */
export const pricePaidTransactions = referenceSchema.table("price_paid_transactions", {
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => datasetSyncs.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull(),
  price: integer("price").notNull(),
  transferDate: date("transfer_date").notNull(),
  propertyType: text("property_type").notNull(),
  newBuild: boolean("new_build").notNull(),
  tenure: text("tenure").notNull(),
  ppdCategory: text("ppd_category").notNull(),
}, (table) => [
  primaryKey({ name: "price_paid_transactions_pk", columns: [table.datasetSyncId, table.transactionId] }),
  check("price_paid_transactions_id_chk", sql`transaction_id ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'`),
  check("price_paid_transactions_price_chk", sql`price > 0`),
  check("price_paid_transactions_type_chk", sql`property_type in ('D', 'S', 'T', 'F', 'O')`),
  check("price_paid_transactions_tenure_chk", sql`tenure in ('F', 'L', 'U')`),
  check("price_paid_transactions_category_chk", sql`ppd_category in ('A', 'B')`),
]);

/** Exact transaction-to-UPRN links as published by HM Land Registry. One sale may link to several UPRNs. */
export const pricePaidUprnLinks = referenceSchema.table("price_paid_uprn_links", {
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => datasetSyncs.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull(),
  uprn: text("uprn").notNull(),
}, (table) => [
  primaryKey({ name: "price_paid_uprn_links_pk", columns: [table.datasetSyncId, table.transactionId, table.uprn] }),
  index("price_paid_uprn_links_uprn_idx").on(table.datasetSyncId, table.uprn),
  check("price_paid_uprn_links_id_chk", sql`transaction_id ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'`),
  check("price_paid_uprn_links_uprn_chk", sql`uprn ~ '^[0-9]{1,12}$'`),
]);

export const enrichmentRuns = pgTable("enrichment_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("queued"),
  inputFingerprint: text("input_fingerprint").notNull(),
  propertyVersion: integer("property_version").notNull(),
  providerStatuses: jsonb("provider_statuses").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  unique("enrichment_runs_org_id_uidx").on(table.organisationId, table.id),
  foreignKey({ name: "enrichment_runs_property_fk", columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }).onDelete("restrict"),
  uniqueIndex("enrichment_runs_idempotency_uidx").on(table.organisationId, table.idempotencyKey),
  index("enrichment_runs_property_idx").on(table.propertyId, table.createdAt),
  check("enrichment_runs_status_chk", sql`status in ('queued', 'running', 'completed', 'partial', 'failed', 'superseded')`),
]);

/** Immutable record of what a source said about a property at retrieval time. Never overwrites surveyor observations. */
export const propertyIntelligenceSnapshots = pgTable("property_intelligence_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull(),
  enrichmentRunId: uuid("enrichment_run_id").notNull(),
  sourceKey: text("source_key").notNull(),
  datasetVersion: text("dataset_version"),
  sourceRecordId: text("source_record_id"),
  category: text("category").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  evidence: jsonb("evidence").$type<{ label: string; url: string }[]>().notNull().default([]),
  matchMethod: text("match_method").notNull(),
  confidence: text("confidence"),
  informationClass: text("information_class").notNull(),
  coverageStatus: text("coverage_status").notNull(),
  resultStatus: text("result_status").notNull(),
  message: text("message"),
  licence: jsonb("licence").$type<Record<string, unknown>>().notNull().default({}),
  inputFingerprint: text("input_fingerprint").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("property_intelligence_snapshots_org_id_uidx").on(table.organisationId, table.id),
  foreignKey({ name: "property_intelligence_snapshots_property_fk", columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }).onDelete("restrict"),
  foreignKey({ name: "property_intelligence_snapshots_run_fk", columns: [table.organisationId, table.enrichmentRunId], foreignColumns: [enrichmentRuns.organisationId, enrichmentRuns.id] }).onDelete("restrict"),
  index("property_intelligence_snapshots_property_idx").on(table.propertyId, table.sourceKey, table.category, table.retrievedAt),
  index("property_intelligence_snapshots_run_idx").on(table.enrichmentRunId),
  check("property_intelligence_snapshots_status_chk", sql`result_status in ('matched', 'no_match', 'unsupported', 'not_configured', 'unavailable', 'error')`),
  check("property_intelligence_snapshots_class_chk", sql`information_class in ('surveyor_verified', 'authoritative_external', 'indicative_external')`),
  check("property_intelligence_snapshots_coverage_chk", sql`coverage_status in ('covered', 'partial', 'not_covered', 'unknown')`),
]);

/**
 * Assistant field proposals. A proposal is never a finding: it changes the
 * form only through an authorised review decision, which records the
 * resulting field value and keeps the evidence chain.
 */
export const fieldProposals = pgTable("field_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  elementId: uuid("element_id"),
  fieldPath: text("field_path").notNull(),
  proposedValue: jsonb("proposed_value").$type<Record<string, unknown>>().notNull(),
  valueType: text("value_type").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<Record<string, unknown>[]>().notNull().default([]),
  originClass: text("origin_class").notNull(),
  limitations: jsonb("limitations").$type<string[]>().notNull().default([]),
  reviewStatus: text("review_status").notNull().default("pending"),
  /** Hash of the inputs (evidence ids and the field value it was proposed against). Acceptance fails if they moved on. */
  inputVersion: text("input_version").notNull(),
  baseValueId: uuid("base_value_id"),
  generator: text("generator").notNull(),
  modelVersion: text("model_version").notNull().default("none"),
  promptVersion: text("prompt_version").notNull().default("none"),
  knowledgeVersion: text("knowledge_version").notNull().default("none"),
  dedupeKey: text("dedupe_key").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewNote: text("review_note"),
  acceptedValueId: uuid("accepted_value_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "field_proposals_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  foreignKey({ name: "field_proposals_element_fk", columns: [table.organisationId, table.elementId], foreignColumns: [surveyElements.organisationId, surveyElements.id] }).onDelete("restrict"),
  uniqueIndex("field_proposals_dedupe_uidx").on(table.surveyId, table.dedupeKey),
  index("field_proposals_pending_idx").on(table.surveyId, table.reviewStatus),
  check("field_proposals_status_chk", sql`review_status in ('pending', 'accepted', 'edited', 'rejected', 'superseded')`),
  check("field_proposals_origin_chk", sql`origin_class in ('external_record', 'job_record', 'prior_survey', 'document_extraction', 'image_analysis', 'model_draft')`),
]);

// Completion checks (A3). A surveyor may proceed past a failing hard gate only
// with a permitted reason; every such decision is kept and cannot be edited.

export const completionOverrides = pgTable("completion_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(),
  surveyId: uuid("survey_id").notNull(),
  itemId: text("item_id").notNull(),
  category: text("category").notNull(),
  ruleId: text("rule_id"),
  ruleSetKey: text("rule_set_key").notNull(),
  ruleSetVersion: text("rule_set_version").notNull(),
  templateVersion: text("template_version").notNull(),
  targetStage: jobStage("target_stage").notNull(),
  reason: text("reason").notNull(),
  note: text("note"),
  overriddenByUserId: uuid("overridden_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "completion_overrides_job_fk", columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }).onDelete("restrict"),
  foreignKey({ name: "completion_overrides_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  index("completion_overrides_job_idx").on(table.organisationId, table.jobId),
  check("completion_overrides_reason_chk", sql`length(btrim(reason)) > 0`),
]);

// Evidence analysis (A4). Deterministic results per media item and analyser
// version: photo quality hints and document facts with page/span references.
// Rows are append-only; they are removed only with their media by erasure.

export const mediaAnalyses = pgTable("media_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  mediaId: uuid("media_id").notNull(),
  surveyId: uuid("survey_id"),
  analyser: text("analyser").notNull(),
  status: text("status").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "media_analyses_media_fk", columns: [table.organisationId, table.mediaId], foreignColumns: [mediaAssets.organisationId, mediaAssets.id] }).onDelete("restrict"),
  foreignKey({ name: "media_analyses_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  uniqueIndex("media_analyses_media_analyser_uidx").on(table.mediaId, table.analyser),
  index("media_analyses_survey_idx").on(table.organisationId, table.surveyId),
  check("media_analyses_status_chk", sql`status in ('completed', 'unavailable', 'failed')`),
]);

// Wording library and report assembly (A5). Clauses are the firm's own
// approved wording; an approved clause never changes (a new version supersedes
// it). Report versions freeze exactly what was composed and from which inputs;
// sign-off is a separate, immutable record made by a person.

export const wordingClauses = pgTable("wording_clauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  clauseKey: text("clause_key").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  purpose: text("purpose").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** "section.element", or null for any element. */
  elementKey: text("element_key"),
  conditionRatings: text("condition_ratings").array().notNull().default(sql`'{}'::text[]`),
  nextActions: text("next_actions").array().notNull().default(sql`'{}'::text[]`),
  inspectionStatuses: text("inspection_statuses").array().notNull().default(sql`'{}'::text[]`),
  jurisdictions: text("jurisdictions").array().notNull().default(sql`'{}'::text[]`),
  serviceLevels: text("service_levels").array().notNull().default(sql`'{}'::text[]`),
  source: text("source").notNull().default("firm_authored"),
  licenceReference: text("licence_reference"),
  supersedesId: uuid("supersedes_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  retiredByUserId: uuid("retired_by_user_id").references(() => users.id, { onDelete: "set null" }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  unique("wording_clauses_org_id_uidx").on(table.organisationId, table.id),
  uniqueIndex("wording_clauses_key_version_uidx").on(table.organisationId, table.clauseKey, table.version),
  uniqueIndex("wording_clauses_one_approved_uidx").on(table.organisationId, table.clauseKey).where(sql`status = 'approved'`),
  index("wording_clauses_org_status_idx").on(table.organisationId, table.status),
  check("wording_clauses_status_chk", sql`status in ('draft', 'approved', 'retired')`),
  check("wording_clauses_purpose_chk", sql`purpose in ('element_narrative', 'recommendation', 'limitation', 'summary', 'legal_matter')`),
  check("wording_clauses_key_chk", sql`clause_key ~ '^[a-z0-9][a-z0-9_.-]{1,80}$'`),
  check("wording_clauses_source_chk", sql`source = 'firm_authored' or (source = 'licensed_third_party' and licence_reference is not null and length(btrim(licence_reference)) > 0)`),
  check("wording_clauses_approval_chk", sql`status = 'draft' or (approved_by_user_id is not null and approved_at is not null)`),
]);

export const reportVersions = pgTable("report_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id").notNull(),
  jobId: uuid("job_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  composer: text("composer").notNull(),
  templateKey: text("template_key").notNull(),
  templateVersion: text("template_version").notNull(),
  templateFingerprint: text("template_fingerprint").notNull(),
  ruleSetVersion: text("rule_set_version"),
  /** Hash of every input the composer read; a later change makes this version out of date. */
  inputFingerprint: text("input_fingerprint").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  /** Ids and versions of field values, observations, clauses, media and snapshots used. */
  trace: jsonb("trace").$type<Record<string, unknown>>().notNull(),
  contentSha256: text("content_sha256").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("report_versions_org_id_uidx").on(table.organisationId, table.id),
  uniqueIndex("report_versions_survey_version_uidx").on(table.surveyId, table.versionNumber),
  foreignKey({ name: "report_versions_survey_fk", columns: [table.organisationId, table.surveyId], foreignColumns: [surveys.organisationId, surveys.id] }).onDelete("restrict"),
  foreignKey({ name: "report_versions_job_fk", columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }).onDelete("restrict"),
]);

export const reportApprovals = pgTable("report_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  reportVersionId: uuid("report_version_id").notNull(),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approverRole: text("approver_role").notNull(),
  statement: text("statement").notNull(),
  note: text("note"),
  contentSha256: text("content_sha256").notNull(),
  /** Completion checks at the moment of sign-off, including any recorded overrides. */
  completion: jsonb("completion").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("report_approvals_version_uidx").on(table.reportVersionId),
  foreignKey({ name: "report_approvals_version_fk", columns: [table.organisationId, table.reportVersionId], foreignColumns: [reportVersions.organisationId, reportVersions.id] }).onDelete("restrict"),
]);

// Scottish EPC Register extracts (P6). Certificate facts keyed by the
// published UPRN reference only; no address field is stored.
export const scottishEpcCertificates = referenceSchema.table("scottish_epc_certificates", {
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => datasetSyncs.id, { onDelete: "cascade" }),
  certificateKey: text("certificate_key").notNull(),
  uprn: text("uprn").notNull(),
  lodgementDate: date("lodgement_date"),
  currentRating: text("current_rating"),
  potentialRating: text("potential_rating"),
  propertyType: text("property_type"),
  builtForm: text("built_form"),
  constructionAgeBand: text("construction_age_band"),
  totalFloorAreaM2: doublePrecision("total_floor_area_m2"),
}, (table) => [
  primaryKey({ name: "scottish_epc_certificates_pk", columns: [table.datasetSyncId, table.certificateKey] }),
  index("scottish_epc_certificates_uprn_idx").on(table.datasetSyncId, table.uprn),
  check("scottish_epc_certificates_uprn_chk", sql`uprn ~ '^[0-9]{1,12}$'`),
  check("scottish_epc_certificates_rating_chk", sql`(current_rating is null or current_rating ~ '^[A-G]$') and (potential_rating is null or potential_rating ~ '^[A-G]$')`),
]);
