CREATE SCHEMA "reference";
--> statement-breakpoint
CREATE TYPE "public"."address_source" AS ENUM('manual', 'postcodes_io', 'nominatim');--> statement-breakpoint
CREATE TYPE "public"."location_confidence" AS ENUM('unresolved', 'postcode_centroid', 'geocoded_address', 'surveyor_confirmed');--> statement-breakpoint
CREATE TYPE "public"."uk_country" AS ENUM('ENG', 'WLS', 'SCT', 'NIR');--> statement-breakpoint
CREATE TABLE "address_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid,
	"provider" text NOT NULL,
	"query_hash" text NOT NULL,
	"status" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference"."data_sources" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organisation" text NOT NULL,
	"category" text NOT NULL,
	"documentation_url" text NOT NULL,
	"access_method" text NOT NULL,
	"coverage" text[] DEFAULT '{}'::text[] NOT NULL,
	"licence" jsonb NOT NULL,
	"register_status" text NOT NULL,
	"checked_at" date,
	"definition" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"verification_notes" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference"."dataset_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"dataset_version" text NOT NULL,
	"source_url" text,
	"checksum" text,
	"licence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_crs" text,
	"extent" text,
	"status" text DEFAULT 'staging' NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"previous_active_id" uuid,
	"imported_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "dataset_syncs_status_chk" CHECK (status in ('staging', 'active', 'retired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "reference"."os_open_uprn" (
	"dataset_sync_id" uuid NOT NULL,
	"uprn" text NOT NULL,
	"geom" geometry(point, 4326) NOT NULL,
	"source_x" double precision,
	"source_y" double precision,
	CONSTRAINT "os_open_uprn_pk" PRIMARY KEY("dataset_sync_id","uprn"),
	CONSTRAINT "os_open_uprn_format_chk" CHECK (uprn ~ '^[0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "property_identity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"previous" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"next_available_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_response_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"dataset_version" text,
	"response" jsonb NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Carries forward the default declared by the Surveynt rebrand schema change (commit 30f549b), which shipped without a migration.
ALTER TABLE "organisation_branding" ALTER COLUMN "accent_colour" SET DEFAULT '#3b82f6';--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "country" "uk_country";--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "uprn" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location" geometry(point, 4326) GENERATED ALWAYS AS (case when latitude is not null and longitude is not null then st_setsrid(st_makepoint(longitude, latitude), 4326) end) STORED;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "address_source" "address_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location_confidence" "location_confidence" DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location_resolution_method" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "confirmed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "uprn_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "uprn_evidence_type" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "identity_address_fingerprint" text;--> statement-breakpoint
ALTER TABLE "address_lookups" ADD CONSTRAINT "address_lookups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_lookups" ADD CONSTRAINT "address_lookups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference"."dataset_syncs" ADD CONSTRAINT "dataset_syncs_source_key_data_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "reference"."data_sources"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference"."os_open_uprn" ADD CONSTRAINT "os_open_uprn_dataset_sync_id_dataset_syncs_id_fk" FOREIGN KEY ("dataset_sync_id") REFERENCES "reference"."dataset_syncs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_identity_events" ADD CONSTRAINT "property_identity_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_identity_events" ADD CONSTRAINT "property_identity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The composite tenant FK below requires this unique key first.
ALTER TABLE "properties" ADD CONSTRAINT "properties_org_id_uidx" UNIQUE("organisation_id","id");--> statement-breakpoint
ALTER TABLE "property_identity_events" ADD CONSTRAINT "property_identity_events_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_lookups_cache_idx" ON "address_lookups" USING btree ("organisation_id","provider","query_hash","created_at");--> statement-breakpoint
CREATE INDEX "address_lookups_expiry_idx" ON "address_lookups" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_syncs_one_active_uidx" ON "reference"."dataset_syncs" USING btree ("source_key") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "dataset_syncs_source_idx" ON "reference"."dataset_syncs" USING btree ("source_key","started_at");--> statement-breakpoint
CREATE INDEX "os_open_uprn_geog_gix" ON "reference"."os_open_uprn" USING gist (("geom"::geography));--> statement-breakpoint
CREATE INDEX "property_identity_events_property_idx" ON "property_identity_events" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "property_identity_events_org_idx" ON "property_identity_events" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "provider_response_cache_expiry_idx" ON "provider_response_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_response_cache_source_idx" ON "provider_response_cache" USING btree ("source_key");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "properties_org_uprn_idx" ON "properties" USING btree ("organisation_id","uprn");--> statement-breakpoint
CREATE INDEX "properties_location_gix" ON "properties" USING gist ("location");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_coordinates_pair_chk" CHECK ((latitude is null) = (longitude is null));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_coordinates_uk_chk" CHECK (latitude is null or (latitude between 49.85 and 60.95 and longitude between -8.75 and 1.8));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_uprn_format_chk" CHECK (uprn is null or uprn ~ '^[0-9]{1,12}$');--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_location_confidence_chk" CHECK ((latitude is null) = (location_confidence = 'unresolved'));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_uprn_confirmation_chk" CHECK (uprn is null or (uprn_confirmed_at is not null and uprn_evidence_type is not null));