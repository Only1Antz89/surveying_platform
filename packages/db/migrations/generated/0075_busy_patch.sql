CREATE TABLE "business_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_locations_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "business_locations_coordinates" CHECK (("business_locations"."latitude" is null and "business_locations"."longitude" is null) or ("business_locations"."latitude" between -90 and 90 and "business_locations"."longitude" between -180 and 180))
);
--> statement-breakpoint
CREATE TABLE "latest_staff_locations" (
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_metres" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_staff_locations_organisation_id_user_id_pk" PRIMARY KEY("organisation_id","user_id"),
	CONSTRAINT "latest_staff_locations_coordinates" CHECK ("latest_staff_locations"."latitude" between -90 and 90 and "latest_staff_locations"."longitude" between -180 and 180 and "latest_staff_locations"."accuracy_metres" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"endpoint" text NOT NULL,
	"credential_env" text,
	"model_id" text,
	"provider_key" text,
	"evaluation_only" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"check_status" text DEFAULT 'unchecked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_connections_kind" CHECK ("platform_connections"."kind" in ('routing','weather','traffic','ai'))
);
--> statement-breakpoint
CREATE TABLE "staff_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"primary_location_id" uuid,
	"service_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage_radius_km" double precision,
	"membership_grade" text,
	"registration_status" text DEFAULT 'unset' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"contact_phone" text,
	"capacity_jobs" integer,
	"portrait_url" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_capabilities_radius" CHECK ("staff_capabilities"."coverage_radius_km" is null or "staff_capabilities"."coverage_radius_km" > 0 and "staff_capabilities"."coverage_radius_km" <= 500),
	CONSTRAINT "staff_capabilities_registration" CHECK ("staff_capabilities"."registration_status" in ('unset','declared','reviewed'))
);
--> statement-breakpoint
CREATE TABLE "surveyant_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid,
	"user_id" uuid,
	"quote_id" uuid,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surveyant_conversations_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "surveyant_conversations_scope" CHECK ("surveyant_conversations"."scope" in ('case','business'))
);
--> statement-breakpoint
CREATE TABLE "surveyant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surveyant_messages_role" CHECK ("surveyant_messages"."role" in ('user','assistant'))
);
--> statement-breakpoint
CREATE TABLE "tenant_connections" (
	"organisation_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"monthly_message_limit" integer DEFAULT 1000 NOT NULL,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_connections_organisation_id_connection_id_pk" PRIMARY KEY("organisation_id","connection_id"),
	CONSTRAINT "tenant_connections_limit" CHECK ("tenant_connections"."monthly_message_limit" between 0 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "tracking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_sessions_org_id_uidx" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
ALTER TABLE "business_locations" ADD CONSTRAINT "business_locations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_staff_locations" ADD CONSTRAINT "latest_staff_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_staff_locations" ADD CONSTRAINT "latest_staff_locations_organisation_id_session_id_tracking_sessions_organisation_id_id_fk" FOREIGN KEY ("organisation_id","session_id") REFERENCES "public"."tracking_sessions"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_capabilities" ADD CONSTRAINT "staff_capabilities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_capabilities" ADD CONSTRAINT "staff_capabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_capabilities" ADD CONSTRAINT "staff_capabilities_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_capabilities" ADD CONSTRAINT "staff_capabilities_organisation_id_primary_location_id_business_locations_organisation_id_id_fk" FOREIGN KEY ("organisation_id","primary_location_id") REFERENCES "public"."business_locations"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyant_conversations" ADD CONSTRAINT "surveyant_conversations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyant_conversations" ADD CONSTRAINT "surveyant_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyant_conversations" ADD CONSTRAINT "surveyant_conversations_organisation_id_job_id_jobs_organisation_id_id_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyant_messages" ADD CONSTRAINT "surveyant_messages_organisation_id_conversation_id_surveyant_conversations_organisation_id_id_fk" FOREIGN KEY ("organisation_id","conversation_id") REFERENCES "public"."surveyant_conversations"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_connections" ADD CONSTRAINT "tenant_connections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_connections" ADD CONSTRAINT "tenant_connections_connection_id_platform_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."platform_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_capabilities_org_user_uidx" ON "staff_capabilities" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX "tracking_sessions_user_idx" ON "tracking_sessions" USING btree ("organisation_id","user_id");--> statement-breakpoint
DO $$ DECLARE tenant_table text; BEGIN
 FOREACH tenant_table IN ARRAY ARRAY['business_locations','staff_capabilities','tenant_connections','surveyant_conversations','surveyant_messages','tracking_sessions','latest_staff_locations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tenant_table);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tenant_table);
 EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',tenant_table || '_tenant_isolation',tenant_table);
 END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The application role has no policy for platform connections: credential references remain server-only.
INSERT INTO business_locations (organisation_id,name,address,latitude,longitude)
SELECT organisation_id,'Primary office',office_address,office_latitude,office_longitude FROM organisation_operational_settings WHERE office_address IS NOT NULL AND btrim(office_address) <> '';
