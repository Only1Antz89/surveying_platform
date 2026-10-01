CREATE TYPE "public"."inspection_status" AS ENUM('inspected', 'partially_inspected', 'not_inspected', 'inaccessible', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('photo', 'document');--> statement-breakpoint
CREATE TYPE "public"."observation_kind" AS ENUM('current_observation', 'measurement', 'client_claim', 'historical_reference', 'external_record');--> statement-breakpoint
CREATE TYPE "public"."observation_status" AS ENUM('recorded', 'superseded', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."survey_status" AS ENUM('in_progress', 'in_review', 'approved', 'issued', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."value_origin" AS ENUM('surveyor_entry', 'accepted_proposal', 'edited_proposal', 'clerical_prefill');--> statement-breakpoint
CREATE TABLE "assistant_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dedupe_key" text NOT NULL,
	"field_path" text,
	"element_key" text,
	"title" text NOT NULL,
	"detail" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_version" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_tasks_status_chk" CHECK (status in ('open', 'resolved', 'dismissed')),
	CONSTRAINT "assistant_tasks_kind_chk" CHECK (kind in ('missing_field', 'pending_verification', 'discrepancy', 'reinspect', 'limitation_required', 'draft_section', 'review_ai_text'))
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"evidence_id" text NOT NULL,
	"region" jsonb,
	"note" text,
	"created_by_user_id" uuid,
	"client_generated_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "evidence_links_target_chk" CHECK (target_type in ('field_value', 'observation', 'element')),
	CONSTRAINT "evidence_links_evidence_chk" CHECK (evidence_type in ('media', 'observation', 'intelligence_snapshot', 'document_span', 'prior_survey', 'external_record'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"survey_id" uuid,
	"kind" "media_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"original_filename" text,
	"captured_at" timestamp with time zone,
	"capture_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"derived_from_id" uuid,
	"derivation" text DEFAULT 'original' NOT NULL,
	"status" text DEFAULT 'stored' NOT NULL,
	"uploaded_by_user_id" uuid,
	"client_generated_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_assets_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "media_assets_derivation_chk" CHECK (derivation in ('original', 'annotated', 'thumbnail', 'redacted', 'processed') and ((derivation = 'original') = (derived_from_id is null))),
	CONSTRAINT "media_assets_status_chk" CHECK (status in ('stored', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"element_id" uuid,
	"kind" "observation_kind" NOT NULL,
	"text" text NOT NULL,
	"structured" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"location_label" text,
	"status" "observation_status" DEFAULT 'recorded' NOT NULL,
	"origin" "value_origin" DEFAULT 'surveyor_entry' NOT NULL,
	"source_kind" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"source_event_date" date,
	"observed_at" timestamp with time zone,
	"author_user_id" uuid,
	"supersedes_id" uuid,
	"client_generated_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observations_org_id_uidx" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
CREATE TABLE "survey_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"element_key" text NOT NULL,
	"location_label" text DEFAULT '' NOT NULL,
	"inspection_status" "inspection_status",
	"limitation_reason" text,
	"updated_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_elements_org_id_uidx" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
CREATE TABLE "survey_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"value" jsonb NOT NULL,
	"origin" "value_origin" DEFAULT 'surveyor_entry' NOT NULL,
	"source_kind" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"source_event_date" date,
	"retrieved_at" timestamp with time zone,
	"author_user_id" uuid,
	"supersedes_id" uuid,
	"superseded_at" timestamp with time zone,
	"correction_reason" text,
	"client_generated_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_field_values_path_chk" CHECK (field_path ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"template_version" text NOT NULL,
	"template_fingerprint" text NOT NULL,
	"service_level" text NOT NULL,
	"jurisdiction" "uk_country" NOT NULL,
	"status" "survey_status" DEFAULT 'in_progress' NOT NULL,
	"client_generated_id" text,
	"created_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surveys_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "surveys_service_level_chk" CHECK (service_level in ('level_1', 'level_2', 'level_3', 'bespoke'))
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"operation_type" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The composite tenant FKs below require this unique key first.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_uidx" UNIQUE("organisation_id","id");--> statement-breakpoint
ALTER TABLE "assistant_tasks" ADD CONSTRAINT "assistant_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tasks" ADD CONSTRAINT "assistant_tasks_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tasks" ADD CONSTRAINT "assistant_tasks_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_derived_fk" FOREIGN KEY ("organisation_id","derived_from_id") REFERENCES "public"."media_assets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_element_fk" FOREIGN KEY ("organisation_id","element_id") REFERENCES "public"."survey_elements"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_elements" ADD CONSTRAINT "survey_elements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_elements" ADD CONSTRAINT "survey_elements_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_elements" ADD CONSTRAINT "survey_elements_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_field_values" ADD CONSTRAINT "survey_field_values_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_field_values" ADD CONSTRAINT "survey_field_values_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_field_values" ADD CONSTRAINT "survey_field_values_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_tasks_dedupe_uidx" ON "assistant_tasks" USING btree ("survey_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "assistant_tasks_open_idx" ON "assistant_tasks" USING btree ("survey_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_links_client_id_uidx" ON "evidence_links" USING btree ("organisation_id","client_generated_id");--> statement-breakpoint
CREATE INDEX "evidence_links_target_idx" ON "evidence_links" USING btree ("survey_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_client_id_uidx" ON "media_assets" USING btree ("organisation_id","client_generated_id");--> statement-breakpoint
CREATE INDEX "media_assets_survey_idx" ON "media_assets" USING btree ("survey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_client_id_uidx" ON "observations" USING btree ("organisation_id","client_generated_id");--> statement-breakpoint
CREATE INDEX "observations_survey_idx" ON "observations" USING btree ("survey_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_elements_location_uidx" ON "survey_elements" USING btree ("survey_id","section_key","element_key","location_label");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_field_values_current_uidx" ON "survey_field_values" USING btree ("survey_id","field_path") WHERE superseded_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_field_values_client_id_uidx" ON "survey_field_values" USING btree ("organisation_id","client_generated_id");--> statement-breakpoint
CREATE INDEX "survey_field_values_history_idx" ON "survey_field_values" USING btree ("survey_id","field_path","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_active_job_uidx" ON "surveys" USING btree ("organisation_id","job_id") WHERE status <> 'withdrawn';--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_client_id_uidx" ON "surveys" USING btree ("organisation_id","client_generated_id");--> statement-breakpoint
CREATE INDEX "surveys_property_idx" ON "surveys" USING btree ("organisation_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_operations_operation_uidx" ON "sync_operations" USING btree ("organisation_id","operation_id");