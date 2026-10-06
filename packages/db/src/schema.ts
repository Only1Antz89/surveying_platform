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

// Website form drafts are separate from immutable publications and customer evidence.
export const websiteFormDrafts = pgTable("website_form_drafts", {
  organisationId: uuid("organisation_id").primaryKey().references(() => organisations.id, { onDelete: "restrict" }),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(1),
  activeVersionId: uuid("active_version_id"),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  ...timestamps,
});
export const websiteFormVersions = pgTable("website_form_versions", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  publishedByUserId: uuid("published_by_user_id").references(() => users.id),
  restoredFromId: uuid("restored_from_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [unique("website_form_versions_org_id_uidx").on(table.organisationId, table.id)]);
export const websiteEnquiries = pgTable("website_enquiries", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  formVersionId: uuid("form_version_id").notNull(), requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(),
  reference: text("reference").notNull(), firstName: text("first_name").notNull(), lastName: text("last_name").notNull(), email: text("email").notNull(), phone: text("phone"),
  address: jsonb("address").$type<Record<string, unknown>>().notNull(), answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
  reason: text("reason").notNull(), isDemo: boolean("is_demo").notNull().default(false), status: text("status").notNull().default("new"),
  ...timestamps,
}, table => [uniqueIndex("website_enquiries_request_uidx").on(table.organisationId, table.requestId), index("website_enquiries_created_idx").on(table.organisationId, table.createdAt), foreignKey({ columns: [table.organisationId, table.formVersionId], foreignColumns: [websiteFormVersions.organisationId, websiteFormVersions.id] })]);
export const websiteFormRateWindows = pgTable("website_form_rate_windows", {
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id), key: text("key").notNull(), windowStart: timestamp("window_start", { withTimezone: true }).notNull(), count: integer("count").notNull(),
}, table => [primaryKey({ columns: [table.organisationId, table.key] })]);

export const organisationStatus = pgEnum("organisation_status", ["provisioning", "active", "suspended", "closed"]);
export const subscriptionStatus = pgEnum("subscription_status", ["incomplete", "trialing", "active", "past_due", "unpaid", "canceled"]);
export const organisationRole = pgEnum("organisation_role", ["owner", "administrator", "manager", "surveyor", "coordinator", "finance", "read_only"]);
export const platformRole = pgEnum("platform_role", ["super_admin", "support", "billing", "compliance", "privacy_reviewer", "technical_reviewer", "release_manager"]);
export const jobStage = pgEnum("job_stage", ["enquiry", "quoted", "instructed", "scheduled", "inspection_complete", "report_drafting", "internal_review", "issued", "paid", "archived"]);
export const supportPermission = pgEnum("support_permission", ["read", "write"]);
export const incidentSeverity = pgEnum("incident_severity", ["low", "medium", "high", "critical"]);
export const incidentStatus = pgEnum("incident_status", ["investigating", "monitoring", "resolved"]);
// Shared with the England property-intelligence release (migration 0006). Values
// used by both implementations; additions are appended so existing rows stay valid.
export const propertyCountry = pgEnum("property_country", ["ENG", "WLS", "SCT", "NIR"]);
export const locationConfidence = pgEnum("location_confidence", ["unresolved", "approximate", "confirmed", "exact", "postcode_centroid", "geocoded_address", "surveyor_confirmed"]);
export const enrichmentStatus = pgEnum("enrichment_status", ["queued", "running", "completed", "partial", "failed", "superseded"]);
export const providerResultStatus = pgEnum("provider_result_status", ["matched", "no_match", "unsupported", "not_configured", "unavailable", "error"]);
export const informationClass = pgEnum("information_class", ["surveyor_verified", "authoritative_external", "indicative_external_context", "indicative_external"]);
export const coverageStatus = pgEnum("coverage_status", ["covered", "partial", "outside_coverage", "unknown", "not_covered"]);
export const datasetSyncStatus = pgEnum("dataset_sync_status", ["queued", "downloading", "validating", "staged", "active", "failed", "rolled_back"]);
export const inspectionStatus = pgEnum("inspection_status", ["inspected", "partially_inspected", "not_inspected", "inaccessible", "not_applicable"]);
export const surveyStatus = pgEnum("survey_status", ["in_progress", "in_review", "approved", "issued", "withdrawn"]);
export const observationKind = pgEnum("observation_kind", ["current_observation", "measurement", "client_claim", "historical_reference", "external_record"]);
export const observationStatus = pgEnum("observation_status", ["recorded", "superseded", "withdrawn"]);
export const valueOrigin = pgEnum("value_origin", ["surveyor_entry", "accepted_proposal", "edited_proposal", "clerical_prefill"]);
export const mediaKind = pgEnum("media_kind", ["photo", "document"]);
export const quoteStatus = pgEnum("quote_status", ["draft", "issued", "viewed", "accepted", "expired", "cancelled", "converted"]);
export const appointmentStatus = pgEnum("appointment_status", ["provisional", "confirmed", "completed", "cancelled", "conflict"]);
export const invoiceStatus = pgEnum("invoice_status", ["draft", "open", "part_paid", "paid", "void", "overdue"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed", "partially_refunded", "refunded"]);

export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrganisationId: text("clerk_organisation_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  practiceType: text("practice_type").notNull(),
  region: text("region").notNull(),
  status: organisationStatus("status").notNull().default("provisioning"),
  suspendedReason: text("suspended_reason"),
  isDemo: boolean("is_demo").notNull().default(false),
  demoGeneration: integer("demo_generation").notNull().default(0),
  demoSeededAt: timestamp("demo_seeded_at", { withTimezone: true }),
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
  canRecordSurvey: boolean("can_record_survey").notNull().default(false),
  canApproveReports: boolean("can_approve_reports").notNull().default(false),
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
  country: propertyCountry("country"),
  uprn: text("uprn"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  // Kept in step with latitude/longitude by the properties_sync_location trigger (migration 0006).
  location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
  addressSource: text("address_source"),
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
  check("properties_coordinates_pair_check", sql`(${table.latitude} is null and ${table.longitude} is null) or (${table.latitude} is not null and ${table.longitude} is not null)`),
  check("properties_latitude_check", sql`${table.latitude} is null or ${table.latitude} between -90 and 90`),
  check("properties_longitude_check", sql`${table.longitude} is null or ${table.longitude} between -180 and 180`),
  check("properties_uprn_check", sql`${table.uprn} is null or ${table.uprn} ~ '^[0-9]{1,12}$'`),
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

/** Only the authenticated user may read or update personal identity/preferences. */
export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  ricsNumber: text("rics_number"),
  professionalDetails: jsonb("professional_details").$type<{ droneOperatorId?: string; droneFlyerId?: string; droneQualification?: string; droneExpiry?: string }>().notNull().default({}),
  reportName: text("report_name"),
  reportContact: jsonb("report_contact").$type<{ email?: string; phone?: string }>().notNull().default({}),
  appearance: jsonb("appearance").$type<{ theme: "system" | "light" | "dark"; reducedMotion: boolean; contrast: "standard" | "high"; density: "comfortable" | "compact"; textSize: "standard" | "large" }>().notNull().default({ theme: "system", reducedMotion: false, contrast: "standard", density: "comfortable", textSize: "standard" }),
  notifications: jsonb("notifications").$type<Record<string, boolean>>().notNull().default({}),
  ...timestamps,
});

export const memberWorkProfiles = pgTable("member_work_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Europe/London"),
  workingHours: jsonb("working_hours").$type<Record<string, { start: string; end: string; closed?: boolean }>>().notNull().default({}),
  routeOrigin: text("route_origin"),
  latitude: doublePrecision("latitude"), longitude: doublePrecision("longitude"),
  ...timestamps,
}, (table) => [uniqueIndex("member_work_profiles_org_user_uidx").on(table.organisationId, table.userId)]);

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

/** Firm-owned operational configuration. Public booking never reads secrets from this row. */
export const organisationOperationalSettings = pgTable("organisation_operational_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Europe/London"),
  officeAddress: text("office_address"),
  officeLatitude: doublePrecision("office_latitude"),
  officeLongitude: doublePrecision("office_longitude"),
  workingDays: jsonb("working_days").$type<string[]>().notNull().default(["monday", "tuesday", "wednesday", "thursday", "friday"]),
  workingHours: jsonb("working_hours").$type<Record<string, { start: string; end: string }>>().notNull().default({}),
  holidayDates: jsonb("holiday_dates").$type<string[]>().notNull().default([]),
  customerBranding: jsonb("customer_branding").$type<{ displayName?: string; logoUrl?: string; accentColour?: string }>().notNull().default({}),
  notificationPreferences: jsonb("notification_preferences").$type<Record<string, boolean>>().notNull().default({}),
  bookingHorizonDays: integer("booking_horizon_days").notNull().default(90),
  travelBufferMinutes: integer("travel_buffer_minutes").notNull().default(30),
  mileageRatePence: integer("mileage_rate_pence").notNull().default(45),
  documentRetentionDays: integer("document_retention_days").notNull().default(2555),
  publicQuotesEnabled: boolean("public_quotes_enabled").notNull().default(false),
  clientPaymentsEnabled: boolean("client_payments_enabled").notNull().default(false),
  surveyEvidenceEnabled: boolean("survey_evidence_enabled").notNull().default(false),
  reportIdentity: jsonb("report_identity").$type<{ companyName?: string; address?: string; email?: string; phone?: string }>().notNull().default({}),
  ...timestamps,
}, (table) => [uniqueIndex("organisation_operational_settings_org_uidx").on(table.organisationId)]);

export const servicePricingVersions = pgTable("service_pricing_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  serviceDefinitionId: uuid("service_definition_id").notNull().references(() => serviceDefinitions.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  currency: text("currency").notNull().default("GBP"),
  baseAmountMinor: integer("base_amount_minor").notNull(),
  vatBasisPoints: integer("vat_basis_points").notNull().default(2000),
  depositBasisPoints: integer("deposit_basis_points").notNull().default(1000),
  durationMinutes: integer("duration_minutes").notNull().default(180),
  validityDays: integer("validity_days").notNull().default(7),
  surcharges: jsonb("surcharges").$type<Record<string, { label: string; amountMinor: number }>>().notNull().default({}),
  recommendationRules: jsonb("recommendation_rules").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [uniqueIndex("service_pricing_versions_service_version_uidx").on(table.serviceDefinitionId, table.version), index("service_pricing_versions_org_idx").on(table.organisationId)]);

export const customerQuotes = pgTable("customer_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  serviceDefinitionId: uuid("service_definition_id").references(() => serviceDefinitions.id, { onDelete: "restrict" }),
  pricingVersionId: uuid("pricing_version_id").references(() => servicePricingVersions.id, { onDelete: "restrict" }),
  reference: text("reference").notNull(),
  publicRequestId: text("public_request_id"),
  status: quoteStatus("status").notNull().default("draft"),
  firstName: text("first_name"), lastName: text("last_name"), email: text("email"), phone: text("phone"),
  propertyAddress: text("property_address"), city: text("city"), postcode: text("postcode"),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  recommendation: jsonb("recommendation").$type<Record<string, unknown>>().notNull().default({}),
  pricingSnapshot: jsonb("pricing_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  currency: text("currency").notNull().default("GBP"),
  subtotalMinor: integer("subtotal_minor").notNull(), vatMinor: integer("vat_minor").notNull(), totalMinor: integer("total_minor").notNull(), depositMinor: integer("deposit_minor").notNull(),
  accessTokenHash: text("access_token_hash").notNull(), tokenRevokedAt: timestamp("token_revoked_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), issuedAt: timestamp("issued_at", { withTimezone: true }), acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }), propertyId: uuid("property_id").references(() => properties.id, { onDelete: "restrict" }), jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [uniqueIndex("customer_quotes_org_reference_uidx").on(table.organisationId, table.reference), uniqueIndex("customer_quotes_org_request_uidx").on(table.organisationId, table.publicRequestId), uniqueIndex("customer_quotes_token_hash_uidx").on(table.accessTokenHash), index("customer_quotes_org_status_idx").on(table.organisationId, table.status)]);

export const quoteSnapshots = pgTable("quote_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), quoteId: uuid("quote_id").notNull().references(() => customerQuotes.id, { onDelete: "restrict" }),
  event: text("event").notNull(), snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("quote_snapshots_quote_idx").on(table.quoteId, table.createdAt), index("quote_snapshots_org_idx").on(table.organisationId)]);

/** Customer statements are independent from quote snapshots and professional findings. */
export const preinspectionDrafts = pgTable("preinspection_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(), propertyId: uuid("property_id").notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(0), ...timestamps,
}, table => [uniqueIndex("preinspection_drafts_org_job_uidx").on(table.organisationId, table.jobId),
  foreignKey({ columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }),
  foreignKey({ columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }),
  check("preinspection_drafts_version_chk", sql`version >= 0`)]);

export const preinspectionSubmissions = pgTable("preinspection_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(), propertyId: uuid("property_id").notNull(),
  version: integer("version").notNull(), requestId: uuid("request_id").notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
  source: text("source").notNull(), actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("preinspection_submissions_org_job_version_uidx").on(table.organisationId, table.jobId, table.version),
  uniqueIndex("preinspection_submissions_request_uidx").on(table.organisationId, table.jobId, table.requestId),
  foreignKey({ columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }),
  foreignKey({ columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }),
  check("preinspection_submissions_source_chk", sql`source in ('customer', 'staff_transcribed_client')`),
  check("preinspection_submissions_version_chk", sql`version > 0`)]);

export const preinspectionDocuments = pgTable("preinspection_documents", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(), propertyId: uuid("property_id").notNull(),
  requestId: uuid("request_id").notNull(), name: text("name").notNull(), contentType: text("content_type").notNull(), sizeBytes: integer("size_bytes").notNull(), checksum: text("checksum").notNull(), storageKey: text("storage_key").notNull(),
  replacesId: uuid("replaces_id"), supersededAt: timestamp("superseded_at", { withTimezone: true }),
  analysis: jsonb("analysis").$type<Record<string, unknown>>().notNull().default({}),
  worksKind: text("works_kind"), associationFingerprint: text("association_fingerprint"), associatedByUserId: uuid("associated_by_user_id").references(() => users.id, { onDelete: "restrict" }), associatedAt: timestamp("associated_at", { withTimezone: true }), associationReason: text("association_reason"),
  source: text("source").notNull(), actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("preinspection_documents_request_uidx").on(table.organisationId, table.jobId, table.requestId),
  index("preinspection_documents_job_idx").on(table.organisationId, table.jobId),
  foreignKey({ columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }),
  foreignKey({ columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }),
  check("preinspection_documents_size_chk", sql`size_bytes > 0 and size_bytes <= 10485760`),
  check("preinspection_documents_association_chk", sql`(works_kind is null and associated_at is null and associated_by_user_id is null and association_fingerprint is null and association_reason is null) or (works_kind in ('extension', 'conversion') and associated_at is not null and associated_by_user_id is not null and association_fingerprint is not null and association_reason is not null)`),
  check("preinspection_documents_source_chk", sql`source in ('customer', 'staff_transcribed_client')`)]);

export const preinspectionLinks = pgTable("preinspection_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(), quoteId: uuid("quote_id").notNull().references(() => customerQuotes.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull(), purpose: text("purpose").notNull().default("preinspection"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("preinspection_links_hash_uidx").on(table.tokenHash), index("preinspection_links_org_job_idx").on(table.organisationId, table.jobId),
  foreignKey({ columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }),
  check("preinspection_links_purpose_chk", sql`purpose = 'preinspection'`)]);

export const availabilityBlocks = pgTable("availability_blocks", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }).notNull(), kind: text("kind").notNull().default("blocked"), reason: text("reason"), source: text("source").notNull().default("surveynt"), externalEventId: text("external_event_id"), ...timestamps,
}, (table) => [index("availability_blocks_org_time_idx").on(table.organisationId, table.startsAt, table.endsAt)]);

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "restrict" }), quoteId: uuid("quote_id").references(() => customerQuotes.id, { onDelete: "restrict" }), surveyorId: uuid("surveyor_id").references(() => users.id, { onDelete: "set null" }),
  status: appointmentStatus("status").notNull().default("provisional"), startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }).notNull(), timezone: text("timezone").notNull().default("Europe/London"), notes: text("notes"), version: integer("version").notNull().default(1), ...timestamps,
}, (table) => [index("appointments_org_time_idx").on(table.organisationId, table.startsAt), uniqueIndex("appointments_quote_uidx").on(table.quoteId)]);

export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), provider: text("provider").notNull(), providerAccountId: text("provider_account_id").notNull(), encryptedCredentials: text("encrypted_credentials").notNull(), encryptionKeyVersion: integer("encryption_key_version").notNull().default(1), syncCursor: text("sync_cursor"), webhookChannelId: text("webhook_channel_id"), webhookExpiresAt: timestamp("webhook_expires_at", { withTimezone: true }), status: text("status").notNull().default("active"), lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), lastError: text("last_error"), ...timestamps,
}, (table) => [uniqueIndex("calendar_connections_provider_account_uidx").on(table.organisationId, table.provider, table.providerAccountId), index("calendar_connections_user_idx").on(table.userId)]);

export const calendarEventLinks = pgTable("calendar_event_links", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }), connectionId: uuid("connection_id").notNull().references(() => calendarConnections.id, { onDelete: "cascade" }), appointmentId: uuid("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }), externalEventId: text("external_event_id").notNull(), externalVersion: text("external_version"), lastSyncedAppointmentVersion: integer("last_synced_appointment_version").notNull().default(1), ...timestamps,
}, (table) => [uniqueIndex("calendar_event_links_connection_appointment_uidx").on(table.connectionId, table.appointmentId), uniqueIndex("calendar_event_links_connection_external_uidx").on(table.connectionId, table.externalEventId), index("calendar_event_links_org_idx").on(table.organisationId)]);

export const calendarConflicts = pgTable("calendar_conflicts", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }), appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "cascade" }), connectionId: uuid("connection_id").notNull().references(() => calendarConnections.id, { onDelete: "cascade" }), kind: text("kind").notNull(), details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}), status: text("status").notNull().default("open"), resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }), resolvedAt: timestamp("resolved_at", { withTimezone: true }), ...timestamps,
}, (table) => [index("calendar_conflicts_org_status_idx").on(table.organisationId, table.status)]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }), quoteId: uuid("quote_id").references(() => customerQuotes.id, { onDelete: "restrict" }), number: text("number").notNull(), status: invoiceStatus("status").notNull().default("draft"), currency: text("currency").notNull().default("GBP"), subtotalMinor: integer("subtotal_minor").notNull(), vatMinor: integer("vat_minor").notNull(), totalMinor: integer("total_minor").notNull(), dueAt: timestamp("due_at", { withTimezone: true }), issuedAt: timestamp("issued_at", { withTimezone: true }), paidAt: timestamp("paid_at", { withTimezone: true }), ...timestamps,
}, (table) => [uniqueIndex("invoices_org_number_uidx").on(table.organisationId, table.number), index("invoices_job_idx").on(table.jobId)]);

export const invoiceLineItems = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }), description: text("description").notNull(), quantity: integer("quantity").notNull().default(1), unitAmountMinor: integer("unit_amount_minor").notNull(), vatBasisPoints: integer("vat_basis_points").notNull().default(2000), ...timestamps,
}, (table) => [index("invoice_line_items_invoice_idx").on(table.invoiceId)]);

export const clientPayments = pgTable("client_payments", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }), quoteId: uuid("quote_id").references(() => customerQuotes.id, { onDelete: "restrict" }), stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(), stripePaymentIntentId: text("stripe_payment_intent_id").unique(), status: paymentStatus("status").notNull().default("pending"), purpose: text("purpose").notNull(), currency: text("currency").notNull().default("GBP"), amountMinor: integer("amount_minor").notNull(), refundedMinor: integer("refunded_minor").notNull().default(0), succeededAt: timestamp("succeeded_at", { withTimezone: true }), ...timestamps,
}, (table) => [index("client_payments_org_status_idx").on(table.organisationId, table.status), index("client_payments_invoice_idx").on(table.invoiceId)]);

export const settlementLedger = pgTable("settlement_ledger", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), paymentId: uuid("payment_id").references(() => clientPayments.id, { onDelete: "restrict" }), entryType: text("entry_type").notNull(), currency: text("currency").notNull().default("GBP"), amountMinor: integer("amount_minor").notNull(), externalSettlementReference: text("external_settlement_reference"), settledAt: timestamp("settled_at", { withTimezone: true }), metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}), createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("settlement_ledger_org_time_idx").on(table.organisationId, table.createdAt), index("settlement_ledger_payment_idx").on(table.paymentId)]);

export const settlementBatches = pgTable("settlement_batches", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), reference: text("reference").notNull(), currency: text("currency").notNull().default("GBP"), totalMinor: integer("total_minor").notNull(), settledAt: timestamp("settled_at", { withTimezone: true }).notNull(), evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}), createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("settlement_batches_org_reference_uidx").on(table.organisationId, table.reference), index("settlement_batches_org_time_idx").on(table.organisationId, table.settledAt)]);

export const settlementBatchItems = pgTable("settlement_batch_items", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), batchId: uuid("batch_id").notNull().references(() => settlementBatches.id, { onDelete: "restrict" }), ledgerEntryId: uuid("ledger_entry_id").notNull().references(() => settlementLedger.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("settlement_batch_items_ledger_uidx").on(table.ledgerEntryId), index("settlement_batch_items_batch_idx").on(table.batchId)]);

export const organisationDocuments = pgTable("organisation_documents", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }), reportVersionId: uuid("report_version_id"), name: text("name").notNull(), category: text("category").notNull(), accessClass: text("access_class").notNull().default("firm"), blobUrl: text("blob_url").notNull(), blobPathname: text("blob_pathname").notNull(), checksum: text("checksum").notNull(), contentType: text("content_type").notNull(), sizeBytes: integer("size_bytes").notNull(), retentionUntil: timestamp("retention_until", { withTimezone: true }), legalHold: boolean("legal_hold").notNull().default(false), uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }), deletedAt: timestamp("deleted_at", { withTimezone: true }), ...timestamps,
}, (table) => [index("organisation_documents_org_category_idx").on(table.organisationId, table.category), index("organisation_documents_job_idx").on(table.jobId)]);

export const communicationTemplates = pgTable("communication_templates", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }), key: text("key").notNull(), subject: text("subject").notNull(), body: text("body").notNull(), active: boolean("active").notNull().default(true), version: integer("version").notNull().default(1), ...timestamps,
}, (table) => [uniqueIndex("communication_templates_org_key_version_uidx").on(table.organisationId, table.key, table.version)]);

export const communicationDeliveries = pgTable("communication_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), templateId: uuid("template_id").references(() => communicationTemplates.id, { onDelete: "set null" }), quoteId: uuid("quote_id").references(() => customerQuotes.id, { onDelete: "restrict" }), jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }),
  channel: text("channel").notNull().default("email"), recipient: text("recipient").notNull(), subject: text("subject"), status: text("status").notNull().default("queued"), providerMessageId: text("provider_message_id"), attempts: integer("attempts").notNull().default(0), lastError: text("last_error"), sentAt: timestamp("sent_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("communication_deliveries_org_status_idx").on(table.organisationId, table.status), index("communication_deliveries_quote_idx").on(table.quoteId)]);

export const reportDeliveries = pgTable("report_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(), organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }), jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "restrict" }), reportVersionId: uuid("report_version_id").notNull(), documentId: uuid("document_id").references(() => organisationDocuments.id, { onDelete: "restrict" }), recipient: text("recipient").notNull(), deliveryMethod: text("delivery_method").notNull().default("secure_link"), status: text("status").notNull().default("pending"), retentionUntil: timestamp("retention_until", { withTimezone: true }), deliveredAt: timestamp("delivered_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("report_deliveries_org_idx").on(table.organisationId, table.createdAt), index("report_deliveries_job_idx").on(table.jobId)]);

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

export const referenceDataSources = referenceSchema.table("data_sources", {
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
export const referenceDatasetSyncs = referenceSchema.table("dataset_syncs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().references(() => referenceDataSources.key, { onDelete: "restrict" }),
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
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => referenceDatasetSyncs.id, { onDelete: "cascade" }),
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
  jurisdiction: propertyCountry("jurisdiction").notNull(),
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
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => referenceDatasetSyncs.id, { onDelete: "cascade" }),
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
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => referenceDatasetSyncs.id, { onDelete: "cascade" }),
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
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => referenceDatasetSyncs.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull(),
  uprn: text("uprn").notNull(),
}, (table) => [
  primaryKey({ name: "price_paid_uprn_links_pk", columns: [table.datasetSyncId, table.transactionId, table.uprn] }),
  index("price_paid_uprn_links_uprn_idx").on(table.datasetSyncId, table.uprn),
  check("price_paid_uprn_links_id_chk", sql`transaction_id ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'`),
  check("price_paid_uprn_links_uprn_chk", sql`uprn ~ '^[0-9]{1,12}$'`),
]);

// England property-intelligence reference tables (migration 0006), used by the
// national import scripts in packages/db/scripts and lib/property-intelligence.
const geometryFeature4326 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(Geometry,4326)";
  },
});

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

export const addressSearchCache = pgTable("address_search_cache", {
  cacheKey: text("cache_key").primaryKey(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  candidates: jsonb("candidates").$type<unknown[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [
  index("address_search_cache_org_expiry_idx").on(table.organisationId, table.expiresAt),
]);

export const addressProviderRateLimits = pgTable("address_provider_rate_limits", {
  provider: text("provider").primaryKey(),
  allowedAfter: timestamp("allowed_after", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  providerStatuses: jsonb("provider_statuses").$type<Record<string, unknown>>().notNull().default({}),
  safeErrors: jsonb("safe_errors").$type<Record<string, string>>().notNull().default({}),
  propertyVersion: integer("property_version").notNull(),
  /** England release: identity fingerprint. This implementation stores its input fingerprint here as well. */
  locationFingerprint: text("location_fingerprint").notNull(),
  inputFingerprint: text("input_fingerprint").notNull().default(""),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  unique("enrichment_runs_org_id_uidx").on(table.organisationId, table.id),
  foreignKey({ name: "enrichment_runs_property_fk", columns: [table.organisationId, table.propertyId], foreignColumns: [properties.organisationId, properties.id] }).onDelete("restrict"),
  uniqueIndex("enrichment_runs_org_idempotency_uidx").on(table.organisationId, table.idempotencyKey),
  index("enrichment_runs_property_time_idx").on(table.propertyId, table.createdAt),
  index("enrichment_runs_org_status_idx").on(table.organisationId, table.status),
]);

/** Immutable record of what a source said about a property at retrieval time. Never overwrites surveyor observations. */
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
  evidence: jsonb("evidence").$type<{ label: string; url: string }[]>().notNull().default([]),
  matchMethod: text("match_method").notNull(),
  /** England release: numeric confidence 0..1. */
  confidence: doublePrecision("confidence").notNull(),
  /** This implementation's confidence label (exact, high, …); numeric confidence is derived from it. */
  confidenceLabel: text("confidence_label"),
  informationClass: informationClass("information_class").notNull(),
  coverageStatus: coverageStatus("coverage_status").notNull(),
  resultStatus: providerResultStatus("result_status").notNull(),
  message: text("message"),
  licenceSnapshot: jsonb("licence_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  licence: jsonb("licence").$type<Record<string, unknown>>().notNull().default({}),
  attribution: text("attribution").notNull(),
  inputFingerprint: text("input_fingerprint").notNull().default(""),
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
  index("property_intelligence_property_source_time_idx").on(table.propertyId, table.sourceKey, table.createdAt),
  index("property_intelligence_org_idx").on(table.organisationId),
  check("property_intelligence_confidence_check", sql`${table.confidence} between 0 and 1`),
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
  check("field_proposals_origin_chk", sql`origin_class in ('external_record', 'job_record', 'practice_record', 'customer_statement', 'prior_survey', 'document_extraction', 'image_analysis', 'model_draft')`),
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
  datasetSyncId: uuid("dataset_sync_id").notNull().references(() => referenceDatasetSyncs.id, { onDelete: "cascade" }),
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

// AI governance (A6). Model use is blocked unless the platform register has an
// approved model for the use, the firm has turned the use on and approved a
// risk assessment, and the job has current consent. Nothing here is enabled
// by default; the register starts empty.

const aiUseCheck = (column: string) => sql.raw(`${column} <@ array['field_proposals', 'photo_observation', 'document_extraction', 'report_prose']::text[]`);

export const aiModelRegister = pgTable("ai_model_register", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerKey: text("provider_key").notNull(),
  modelId: text("model_id").notNull(),
  modelVersion: text("model_version").notNull(),
  uses: text("uses").array().notNull().default(sql`'{}'::text[]`),
  status: text("status").notNull().default("proposed"),
  processingLocation: text("processing_location"),
  retentionTerms: text("retention_terms"),
  evaluationSummary: jsonb("evaluation_summary").$type<Record<string, unknown>>().notNull().default({}),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  approvedByStaffId: uuid("approved_by_staff_id").references(() => platformStaff.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  ...timestamps,
}, (table) => [
  uniqueIndex("ai_model_register_model_uidx").on(table.providerKey, table.modelId, table.modelVersion),
  check("ai_model_register_status_chk", sql`status in ('proposed', 'approved', 'suspended', 'retired')`),
  check("ai_model_register_uses_chk", aiUseCheck("uses")),
  check("ai_model_register_approval_chk", sql`status <> 'approved' or (approved_at is not null and evaluated_at is not null)`),
]);

export const organisationAiSettings = pgTable("organisation_ai_settings", {
  organisationId: uuid("organisation_id").primaryKey().references(() => organisations.id, { onDelete: "restrict" }),
  aiFeaturesEnabled: boolean("ai_features_enabled").notNull().default(false),
  permittedUses: text("permitted_uses").array().notNull().default(sql`'{}'::text[]`),
  disclosureText: text("disclosure_text"),
  disclosureVersion: integer("disclosure_version").notNull().default(0),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, () => [
  check("organisation_ai_settings_uses_chk", aiUseCheck("permitted_uses")),
  check("organisation_ai_settings_disclosure_chk", sql`not ai_features_enabled or (disclosure_text is not null and disclosure_version > 0)`),
]);

export const aiConsentRecords = pgTable("ai_consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(),
  status: text("status").notNull(),
  uses: text("uses").array().notNull().default(sql`'{}'::text[]`),
  disclosureVersion: integer("disclosure_version").notNull(),
  method: text("method").notNull(),
  note: text("note"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "ai_consent_records_job_fk", columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }).onDelete("restrict"),
  index("ai_consent_records_job_idx").on(table.organisationId, table.jobId, table.createdAt),
  check("ai_consent_records_status_chk", sql`status in ('granted', 'withdrawn')`),
  check("ai_consent_records_method_chk", sql`method in ('written', 'electronic', 'verbal_recorded', 'terms_of_engagement')`),
  check("ai_consent_records_uses_chk", aiUseCheck("uses")),
]);

export const aiRiskAssessments = pgTable("ai_risk_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  use: text("use").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  risks: jsonb("risks").$type<{ risk: string; likelihood: string; impact: string; mitigation: string }[]>().notNull().default([]),
  status: text("status").notNull().default("draft"),
  reviewDue: date("review_due"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("ai_risk_assessments_org_use_idx").on(table.organisationId, table.use, table.status),
  check("ai_risk_assessments_status_chk", sql`status in ('draft', 'approved', 'superseded')`),
  check("ai_risk_assessments_use_chk", sql`use in ('field_proposals', 'photo_observation', 'document_extraction', 'report_prose')`),
  check("ai_risk_assessments_approval_chk", sql`status = 'draft' or (approved_by_user_id is not null and approved_at is not null)`),
]);

export const aiIncidents = pgTable("ai_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id"),
  surveyId: uuid("survey_id"),
  relatedRecord: text("related_record"),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  correctionNote: text("correction_note"),
  reportedByUserId: uuid("reported_by_user_id").references(() => users.id, { onDelete: "set null" }),
  closedByUserId: uuid("closed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "ai_incidents_job_fk", columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }).onDelete("restrict"),
  index("ai_incidents_org_status_idx").on(table.organisationId, table.status),
  check("ai_incidents_category_chk", sql`category in ('incorrect_output', 'unsupported_claim', 'privacy', 'bias', 'security', 'availability', 'other')`),
  check("ai_incidents_severity_chk", sql`severity in ('low', 'medium', 'high', 'critical')`),
  check("ai_incidents_status_chk", sql`status in ('open', 'investigating', 'corrected', 'closed')`),
  check("ai_incidents_closure_chk", sql`status not in ('corrected', 'closed') or (correction_note is not null and length(btrim(correction_note)) > 0)`),
]);

// Shared learning (L0-L4). Disabled by default: nothing is copied out of a
// workspace unless the platform flag is on, a policy with release criteria is
// published, and the firm has granted the specific scope with confirmations.
// Restricted staging lives in its own schema with no tenant-role grant; only
// released, generalised cases reach the shared schema.

const learningScopeCheck = (column: string) => sql.raw(`${column} in ('structured_cases', 'photos', 'evaluation', 'model_training')`);

export const learningPolicyVersions = pgTable("learning_policy_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull().unique(),
  status: text("status").notNull().default("draft"),
  summary: text("summary").notNull(),
  policyDocumentRef: text("policy_document_ref").notNull(),
  privacyAssessmentRef: text("privacy_assessment_ref"),
  releaseCriteria: jsonb("release_criteria").$type<Record<string, unknown>>().notNull().default({}),
  publishedByStaffId: uuid("published_by_staff_id").references(() => platformStaff.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, () => [
  check("learning_policy_versions_status_chk", sql`status in ('draft', 'published', 'retired')`),
  check("learning_policy_versions_published_chk", sql`status = 'draft' or (published_at is not null and privacy_assessment_ref is not null)`),
]);

export const learningContributionGrants = pgTable("learning_contribution_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  policyVersion: text("policy_version").notNull(),
  confirmations: text("confirmations").array().notNull().default(sql`'{}'::text[]`),
  basis: text("basis"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("learning_contribution_grants_org_scope_idx").on(table.organisationId, table.scope, table.createdAt),
  check("learning_contribution_grants_scope_chk", learningScopeCheck("scope")),
  check("learning_contribution_grants_status_chk", sql`status in ('granted', 'revoked')`),
  check("learning_contribution_grants_confirmed_chk", sql`status = 'revoked' or (confirmations @> array['client_information_authority', 'third_party_rights', 'policy_accepted']::text[] and basis is not null and length(btrim(basis)) >= 10)`),
]);

export const learningWithdrawalRequests = pgTable("learning_withdrawal_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  scope: text("scope"),
  jobId: uuid("job_id"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("requested"),
  outcome: jsonb("outcome").$type<Record<string, unknown>>().notNull().default({}),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "learning_withdrawal_requests_job_fk", columns: [table.organisationId, table.jobId], foreignColumns: [jobs.organisationId, jobs.id] }).onDelete("restrict"),
  index("learning_withdrawal_requests_org_idx").on(table.organisationId, table.status),
  check("learning_withdrawal_requests_scope_chk", sql`scope is null or ${learningScopeCheck("scope")}`),
  check("learning_withdrawal_requests_status_chk", sql`status in ('requested', 'completed')`),
  check("learning_withdrawal_requests_completed_chk", sql`status = 'requested' or completed_at is not null`),
]);

export const learningRestricted = pgSchema("learning_restricted");

/** Pseudonymous contributor key per firm. Restricted: it links back to the firm for withdrawal. */
export const learningContributors = learningRestricted.table("contributors", {
  organisationId: uuid("organisation_id").primaryKey(),
  contributorKey: uuid("contributor_key").notNull().unique().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const learningCandidates = learningRestricted.table("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull(),
  contributorKey: uuid("contributor_key").notNull(),
  jobId: uuid("job_id").notNull(),
  surveyId: uuid("survey_id").notNull(),
  elementId: uuid("element_id").notNull(),
  elementRef: text("element_ref").notNull(),
  scope: text("scope").notNull(),
  grantId: uuid("grant_id").notNull(),
  policyVersion: text("policy_version").notNull(),
  /** Report version and element; the same signed-off material is never extracted twice. */
  sourceFingerprint: text("source_fingerprint").notNull().unique(),
  dedupKey: text("dedup_key").notNull(),
  groupKey: text("group_key").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull(),
  statusReason: text("status_reason"),
  ...timestamps,
}, (table) => [
  index("learning_candidates_status_idx").on(table.status, table.createdAt),
  index("learning_candidates_org_idx").on(table.organisationId, table.scope, table.jobId),
  check("learning_candidates_scope_chk", learningScopeCheck("scope")),
  check("learning_candidates_status_chk", sql`status in ('awaiting_privacy_review', 'quarantined', 'awaiting_technical_review', 'approved', 'released', 'rejected', 'withdrawn')`),
]);

export const learningSanitisationRuns = learningRestricted.table("sanitisation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => learningCandidates.id, { onDelete: "cascade" }),
  transformer: text("transformer").notNull(),
  output: jsonb("output").$type<Record<string, unknown>>().notNull(),
  findings: jsonb("findings").$type<{ field: string; kind: string; count: number }[]>().notNull().default([]),
  residualTerms: text("residual_terms").array().notNull().default(sql`'{}'::text[]`),
  flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
  quasiKey: text("quasi_key").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("learning_sanitisation_runs_candidate_idx").on(table.candidateId, table.createdAt),
  index("learning_sanitisation_runs_quasi_idx").on(table.quasiKey),
  check("learning_sanitisation_runs_outcome_chk", sql`outcome in ('passed', 'quarantined')`),
]);

export const learningReviews = learningRestricted.table("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => learningCandidates.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  reviewerStaffId: uuid("reviewer_staff_id").notNull(),
  decision: text("decision").notNull(),
  checks: text("checks").array().notNull().default(sql`'{}'::text[]`),
  reviewed: jsonb("reviewed").$type<Record<string, unknown>>(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("learning_reviews_candidate_idx").on(table.candidateId, table.stage, table.createdAt),
  check("learning_reviews_stage_chk", sql`stage in ('privacy', 'technical')`),
  check("learning_reviews_decision_chk", sql`decision in ('approved', 'rejected')`),
  check("learning_reviews_reviewed_chk", sql`stage = 'privacy' or decision = 'rejected' or reviewed is not null`),
]);

/** Restricted audit: who extracted, reviewed, released or withdrew what. Append-only. */
export const learningAuditLog = learningRestricted.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorStaffId: uuid("actor_staff_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  organisationId: uuid("organisation_id"),
  candidateId: uuid("candidate_id"),
  releaseId: uuid("release_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("learning_audit_log_created_idx").on(table.createdAt)]);

// Releases (L2). The restricted side keeps the manifest and the lineage from
// each released case back to its candidate (for withdrawal). The shared side
// holds only the generalised, reviewed case and its release; no lineage.

export const learningReleases = learningRestricted.table("releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull().unique(),
  status: text("status").notNull().default("draft"),
  policyVersion: text("policy_version").notNull(),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  problems: jsonb("problems").$type<string[]>().notNull().default([]),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  privacySignoffStaffId: uuid("privacy_signoff_staff_id"),
  privacySignoffAt: timestamp("privacy_signoff_at", { withTimezone: true }),
  privacyNote: text("privacy_note"),
  approvedByStaffId: uuid("approved_by_staff_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  activatedByStaffId: uuid("activated_by_staff_id"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  ...timestamps,
}, () => [
  check("learning_releases_status_chk", sql`status in ('draft', 'approved', 'active', 'superseded', 'rolled_back', 'retired')`),
  check("learning_releases_approval_chk", sql`status = 'draft' or (privacy_signoff_staff_id is not null and approved_by_staff_id is not null and approved_by_staff_id <> privacy_signoff_staff_id)`),
]);

export const learningReleaseItems = learningRestricted.table("release_items", {
  releaseId: uuid("release_id").notNull().references(() => learningReleases.id, { onDelete: "restrict" }),
  candidateId: uuid("candidate_id").notNull().references(() => learningCandidates.id, { onDelete: "restrict" }),
  sharedCaseId: uuid("shared_case_id").notNull().unique().defaultRandom(),
  weight: doublePrecision("weight").notNull(),
  status: text("status").notNull().default("included"),
  statusReason: text("status_reason"),
}, (table) => [
  primaryKey({ name: "learning_release_items_pk", columns: [table.releaseId, table.candidateId] }),
  index("learning_release_items_candidate_idx").on(table.candidateId),
  check("learning_release_items_status_chk", sql`status in ('included', 'withdrawn', 'retracted')`),
  check("learning_release_items_weight_chk", sql`weight > 0 and weight <= 1`),
]);

export const learningShared = pgSchema("learning_shared");

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const sharedReleases = learningShared.table("releases", {
  id: uuid("id").primaryKey(),
  version: text("version").notNull().unique(),
  status: text("status").notNull(),
  caseCount: integer("case_count").notNull(),
  coverage: jsonb("coverage").$type<Record<string, unknown>>().notNull().default({}),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
}, () => [
  check("shared_releases_status_chk", sql`status in ('active', 'inactive')`),
]);

export const sharedCases = learningShared.table("cases", {
  id: uuid("id").primaryKey(),
  releaseId: uuid("release_id").notNull().references(() => sharedReleases.id, { onDelete: "cascade" }),
  jurisdiction: text("jurisdiction").notNull(),
  serviceLevel: text("service_level").notNull(),
  template: text("template").notNull(),
  propertyType: text("property_type"),
  builtForm: text("built_form"),
  ageBand: text("age_band"),
  elementKey: text("element_key").notNull(),
  elementLabel: text("element_label").notNull(),
  inspectionStatus: text("inspection_status"),
  observedFeature: text("observed_feature").notNull(),
  possibleCauses: text("possible_causes").array().notNull().default(sql`'{}'::text[]`),
  confirmedCause: text("confirmed_cause"),
  confirmationBasis: text("confirmation_basis"),
  surveyorJudgement: text("surveyor_judgement").notNull(),
  ratingExample: text("rating_example"),
  nextSteps: text("next_steps").array().notNull().default(sql`'{}'::text[]`),
  limitations: text("limitations"),
  uncertainty: text("uncertainty").notNull(),
  evidenceStrength: text("evidence_strength").notNull(),
  knowledgeReviewDue: date("knowledge_review_due").notNull(),
  ratingDisagreement: boolean("rating_disagreement").notNull(),
  noDefect: boolean("no_defect").notNull(),
  weight: doublePrecision("weight").notNull(),
  searchText: text("search_text").notNull(),
  search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, search_text)`),
}, (table) => [
  index("shared_cases_release_element_idx").on(table.releaseId, table.elementKey, table.jurisdiction),
  index("shared_cases_search_idx").using("gin", table.search),
]);

// L3: feedback and evaluation. Feedback on a shared case is evaluation input
// for reviewers; there is no path from feedback to training.

export const learningCaseFeedback = pgTable("learning_case_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "restrict" }),
  sharedCaseId: uuid("shared_case_id").notNull(),
  releaseVersion: text("release_version").notNull(),
  rating: text("rating").notNull(),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("learning_case_feedback_case_idx").on(table.sharedCaseId),
  index("learning_case_feedback_org_idx").on(table.organisationId, table.createdAt),
  check("learning_case_feedback_rating_chk", sql`rating in ('helpful', 'not_helpful', 'incorrect', 'identifying')`),
]);

export const learningEvaluationRuns = learningRestricted.table("evaluation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull().references(() => learningReleases.id, { onDelete: "restrict" }),
  method: text("method").notNull(),
  options: jsonb("options").$type<Record<string, unknown>>().notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  leakage: jsonb("leakage").$type<Record<string, unknown>>().notNull(),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("learning_evaluation_runs_release_idx").on(table.releaseId, table.createdAt)]);
