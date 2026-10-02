CREATE TABLE "ai_consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text NOT NULL,
	"uses" text[] DEFAULT '{}'::text[] NOT NULL,
	"disclosure_version" integer NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_consent_records_status_chk" CHECK (status in ('granted', 'withdrawn')),
	CONSTRAINT "ai_consent_records_method_chk" CHECK (method in ('written', 'electronic', 'verbal_recorded', 'terms_of_engagement')),
	CONSTRAINT "ai_consent_records_uses_chk" CHECK (uses <@ array['field_proposals', 'photo_observation', 'document_extraction', 'report_prose']::text[])
);
--> statement-breakpoint
CREATE TABLE "ai_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid,
	"survey_id" uuid,
	"related_record" text,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"correction_note" text,
	"reported_by_user_id" uuid,
	"closed_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_incidents_category_chk" CHECK (category in ('incorrect_output', 'unsupported_claim', 'privacy', 'bias', 'security', 'availability', 'other')),
	CONSTRAINT "ai_incidents_severity_chk" CHECK (severity in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "ai_incidents_status_chk" CHECK (status in ('open', 'investigating', 'corrected', 'closed')),
	CONSTRAINT "ai_incidents_closure_chk" CHECK (status not in ('corrected', 'closed') or (correction_note is not null and length(btrim(correction_note)) > 0))
);
--> statement-breakpoint
CREATE TABLE "ai_model_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"uses" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"processing_location" text,
	"retention_terms" text,
	"evaluation_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_at" timestamp with time zone,
	"approved_by_staff_id" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_register_status_chk" CHECK (status in ('proposed', 'approved', 'suspended', 'retired')),
	CONSTRAINT "ai_model_register_uses_chk" CHECK (uses <@ array['field_proposals', 'photo_observation', 'document_extraction', 'report_prose']::text[]),
	CONSTRAINT "ai_model_register_approval_chk" CHECK (status <> 'approved' or (approved_at is not null and evaluated_at is not null))
);
--> statement-breakpoint
CREATE TABLE "ai_risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"use" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_due" date,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_risk_assessments_status_chk" CHECK (status in ('draft', 'approved', 'superseded')),
	CONSTRAINT "ai_risk_assessments_use_chk" CHECK (use in ('field_proposals', 'photo_observation', 'document_extraction', 'report_prose')),
	CONSTRAINT "ai_risk_assessments_approval_chk" CHECK (status = 'draft' or (approved_by_user_id is not null and approved_at is not null))
);
--> statement-breakpoint
CREATE TABLE "organisation_ai_settings" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"ai_features_enabled" boolean DEFAULT false NOT NULL,
	"permitted_uses" text[] DEFAULT '{}'::text[] NOT NULL,
	"disclosure_text" text,
	"disclosure_version" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_ai_settings_uses_chk" CHECK (permitted_uses <@ array['field_proposals', 'photo_observation', 'document_extraction', 'report_prose']::text[]),
	CONSTRAINT "organisation_ai_settings_disclosure_chk" CHECK (not ai_features_enabled or (disclosure_text is not null and disclosure_version > 0))
);
--> statement-breakpoint
ALTER TABLE "ai_consent_records" ADD CONSTRAINT "ai_consent_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_consent_records" ADD CONSTRAINT "ai_consent_records_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_consent_records" ADD CONSTRAINT "ai_consent_records_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_register" ADD CONSTRAINT "ai_model_register_approved_by_staff_id_platform_staff_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_ai_settings" ADD CONSTRAINT "organisation_ai_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_ai_settings" ADD CONSTRAINT "organisation_ai_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_consent_records_job_idx" ON "ai_consent_records" USING btree ("organisation_id","job_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_incidents_org_status_idx" ON "ai_incidents" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_register_model_uidx" ON "ai_model_register" USING btree ("provider_key","model_id","model_version");--> statement-breakpoint
CREATE INDEX "ai_risk_assessments_org_use_idx" ON "ai_risk_assessments" USING btree ("organisation_id","use","status");