CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."coverage_status" AS ENUM('covered', 'partial', 'outside_coverage', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."dataset_sync_status" AS ENUM('queued', 'downloading', 'validating', 'staged', 'active', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."enrichment_status" AS ENUM('queued', 'running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."information_class" AS ENUM('surveyor_verified', 'authoritative_external', 'indicative_external_context');--> statement-breakpoint
CREATE TYPE "public"."location_confidence" AS ENUM('unresolved', 'approximate', 'confirmed', 'exact');--> statement-breakpoint
CREATE TYPE "public"."property_country" AS ENUM('ENG', 'WLS', 'SCT', 'NIR');--> statement-breakpoint
CREATE TYPE "public"."provider_result_status" AS ENUM('matched', 'no_match', 'unsupported', 'not_configured', 'unavailable', 'error');--> statement-breakpoint
CREATE TABLE "data_sources" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organisation" text NOT NULL,
	"category" text NOT NULL,
	"documentation_url" text NOT NULL,
	"access_url" text,
	"licence" text NOT NULL,
	"licence_url" text,
	"attribution" text NOT NULL,
	"coverage_countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"limitations" text,
	"access_requirements" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"refresh_policy" text,
	"verified_at" timestamp with time zone,
	"latest_successful_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"dataset_version_id" uuid,
	"status" "dataset_sync_status" DEFAULT 'queued' NOT NULL,
	"source_url" text NOT NULL,
	"checksum" text,
	"record_count" integer,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"safe_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"version" text NOT NULL,
	"checksum" text NOT NULL,
	"source_url" text NOT NULL,
	"licence_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrichment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"status" "enrichment_status" DEFAULT 'queued' NOT NULL,
	"provider_statuses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"safe_errors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"property_version" integer NOT NULL,
	"location_fingerprint" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os_uprn_points" (
	"dataset_version_id" uuid NOT NULL,
	"uprn" text NOT NULL,
	"location" geometry(Point,4326) NOT NULL,
	"source_easting" double precision,
	"source_northing" double precision,
	CONSTRAINT "os_uprn_points_uprn_check" CHECK ("os_uprn_points"."uprn" ~ '^[0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "property_intelligence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"enrichment_run_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"dataset_version" text,
	"source_record_id" text,
	"category" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_method" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"confidence" double precision NOT NULL,
	"information_class" "information_class" NOT NULL,
	"coverage_status" "coverage_status" NOT NULL,
	"result_status" "provider_result_status" NOT NULL,
	"licence_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attribution" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_intelligence_confidence_check" CHECK ("property_intelligence_snapshots"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "spatial_reference_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_record_id" text NOT NULL,
	"name" text,
	"geometry" geometry(Point,4326) NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation_branding" ALTER COLUMN "accent_colour" SET DEFAULT '#3b82f6';--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "country" "property_country";--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "uprn" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location" geometry(Point,4326);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "address_source" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location_confidence" "location_confidence" DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location_resolution_method" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "confirmed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dataset_syncs" ADD CONSTRAINT "dataset_syncs_source_key_data_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."data_sources"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_syncs" ADD CONSTRAINT "dataset_syncs_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_source_key_data_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."data_sources"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_uprn_points" ADD CONSTRAINT "os_uprn_points_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_enrichment_run_id_enrichment_runs_id_fk" FOREIGN KEY ("enrichment_run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spatial_reference_features" ADD CONSTRAINT "spatial_reference_features_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spatial_reference_features" ADD CONSTRAINT "spatial_reference_features_source_key_data_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."data_sources"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_syncs_source_time_idx" ON "dataset_syncs" USING btree ("source_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_versions_source_version_uidx" ON "dataset_versions" USING btree ("source_key","version");--> statement-breakpoint
CREATE INDEX "dataset_versions_source_active_idx" ON "dataset_versions" USING btree ("source_key","active");--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_runs_org_idempotency_uidx" ON "enrichment_runs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "enrichment_runs_property_time_idx" ON "enrichment_runs" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "enrichment_runs_org_status_idx" ON "enrichment_runs" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "os_uprn_points_version_uprn_uidx" ON "os_uprn_points" USING btree ("dataset_version_id","uprn");--> statement-breakpoint
CREATE INDEX "os_uprn_points_location_gix" ON "os_uprn_points" USING gist ("location");--> statement-breakpoint
CREATE INDEX "property_intelligence_property_source_time_idx" ON "property_intelligence_snapshots" USING btree ("property_id","source_key","created_at");--> statement-breakpoint
CREATE INDEX "property_intelligence_org_idx" ON "property_intelligence_snapshots" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spatial_reference_version_record_uidx" ON "spatial_reference_features" USING btree ("dataset_version_id","source_record_id");--> statement-breakpoint
CREATE INDEX "spatial_reference_source_idx" ON "spatial_reference_features" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "spatial_reference_geometry_gix" ON "spatial_reference_features" USING gist ("geometry");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "properties_org_uprn_idx" ON "properties" USING btree ("organisation_id","uprn");--> statement-breakpoint
CREATE INDEX "properties_location_gix" ON "properties" USING gist ("location");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_coordinates_pair_check" CHECK (("properties"."latitude" is null and "properties"."longitude" is null) or ("properties"."latitude" is not null and "properties"."longitude" is not null));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_latitude_check" CHECK ("properties"."latitude" is null or "properties"."latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_longitude_check" CHECK ("properties"."longitude" is null or "properties"."longitude" between -180 and 180);--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_uprn_check" CHECK ("properties"."uprn" is null or "properties"."uprn" ~ '^[0-9]{1,12}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_versions_one_active_per_source_uidx" ON "dataset_versions" ("source_key") WHERE "active" = true;
--> statement-breakpoint
ALTER TABLE "enrichment_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "enrichment_runs_tenant_policy" ON "enrichment_runs" FOR ALL
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "property_intelligence_snapshots_tenant_policy" ON "property_intelligence_snapshots" FOR ALL
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "data_sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dataset_syncs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "os_uprn_points" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "spatial_reference_features" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "data_sources_read_policy" ON "data_sources" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "dataset_versions_read_policy" ON "dataset_versions" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "dataset_syncs_read_policy" ON "dataset_syncs" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "os_uprn_points_read_policy" ON "os_uprn_points" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "spatial_reference_features_read_policy" ON "spatial_reference_features" FOR SELECT USING (true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_property_location() RETURNS trigger AS $$
BEGIN
  IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
    NEW.location := NULL;
  ELSE
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER properties_sync_location BEFORE INSERT OR UPDATE OF latitude, longitude ON properties
FOR EACH ROW EXECUTE FUNCTION sync_property_location();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Property intelligence snapshots are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER property_intelligence_snapshots_immutable BEFORE UPDATE OR DELETE ON property_intelligence_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
--> statement-breakpoint
INSERT INTO "data_sources" ("key", "name", "organisation", "category", "documentation_url", "access_url", "licence", "licence_url", "attribution", "coverage_countries", "limitations", "access_requirements", "enabled", "refresh_policy", "verified_at") VALUES
('os_open_uprn', 'OS Open UPRN', 'Ordnance Survey', 'identity', 'https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-uprn', 'https://osdatahub.os.uk/downloads/open/OpenUPRN', 'OS OpenData Licence', 'https://www.ordnancesurvey.co.uk/licensing/licences/open-government-licence', 'Contains OS data © Crown copyright and database right', ARRAY['ENG'], 'Identifier and coordinate data only; not a postal address directory.', 'National download and database capacity required.', false, 'Check each published release.', now()),
('planning_data', 'Planning Data', 'MHCLG', 'planning', 'https://www.planning.data.gov.uk/docs', 'https://www.planning.data.gov.uk/entity.json', 'Open Government Licence v3.0', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', '© Crown copyright and database right', ARRAY['ENG'], 'Coverage varies by dataset and local planning authority.', 'Public beta API; polite rate limiting required.', true, 'Cache for 7 days or refresh on demand.', now()),
('epc', 'Energy Performance of Buildings Data', 'MHCLG', 'energy', 'https://get-energy-performance-data.communities.gov.uk/', 'https://epc.opendatacommunities.org/docs/api', 'Provider terms and address restrictions apply', 'https://epc.opendatacommunities.org/docs/copyright', 'Energy Performance of Buildings Data', ARRAY['ENG'], 'Records may be expired, replaced, opted out, or absent.', 'Account, API credentials and licence acceptance required.', false, 'Cache for 30 days or refresh on demand.', now()),
('historic_england', 'National Heritage List for England', 'Historic England', 'heritage', 'https://historicengland.org.uk/listing/the-list/data-downloads', 'https://opendata-historicengland.hub.arcgis.com/', 'Open Government Licence v3.0', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', '© Historic England', ARRAY['ENG'], 'Conservation-area coverage is not a complete substitute for local authority records.', 'Versioned national download required.', false, 'Check monthly and on published updates.', now()),
('hmlr_inspire', 'INSPIRE Index Polygons', 'HM Land Registry', 'land', 'https://www.gov.uk/guidance/inspire-index-polygons-spatial-data', 'https://use-land-property-data.service.gov.uk/', 'Open Government Licence v3.0', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', 'Contains HM Land Registry data © Crown copyright and database right', ARRAY['ENG'], 'Indicative registered freehold extent; not a legal title boundary and not complete leasehold coverage.', 'Account/download workflow may be required.', false, 'Check monthly.', now()),
('ea_flood_zone_2', 'Flood Map for Planning — Flood Zone 2', 'Environment Agency', 'environment', 'https://environment.data.gov.uk/support/faqs/778338325/798130238', 'https://environment.data.gov.uk/', 'Open Government Licence v3.0', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', '© Environment Agency copyright and/or database right', ARRAY['ENG'], 'Planning context only; not a property-specific flood-risk assessment.', 'National download or OGC API access required.', false, 'Check quarterly and on published change.', now()),
('ea_flood_zone_3', 'Flood Map for Planning — Flood Zone 3', 'Environment Agency', 'environment', 'https://environment.data.gov.uk/support/faqs/778338325/798130238', 'https://environment.data.gov.uk/', 'Open Government Licence v3.0', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', '© Environment Agency copyright and/or database right', ARRAY['ENG'], 'Planning context only; not a property-specific flood-risk assessment.', 'National download or OGC API access required.', false, 'Check quarterly and on published change.', now())
ON CONFLICT ("key") DO NOTHING;
