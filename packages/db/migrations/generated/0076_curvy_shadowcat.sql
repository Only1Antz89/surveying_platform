CREATE TABLE "client_case_publications" (
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"property_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"released_by_user_id" uuid NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_case_publications_organisation_id_job_id_pk" PRIMARY KEY("organisation_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "platform_assistant_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_consent_records" DROP CONSTRAINT "ai_consent_records_uses_chk";--> statement-breakpoint
ALTER TABLE "ai_model_register" DROP CONSTRAINT "ai_model_register_uses_chk";--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" DROP CONSTRAINT "ai_risk_assessments_use_chk";--> statement-breakpoint
ALTER TABLE "organisation_ai_settings" DROP CONSTRAINT "organisation_ai_settings_uses_chk";--> statement-breakpoint
ALTER TABLE "client_case_publications" ADD CONSTRAINT "client_case_publications_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_case_publications" ADD CONSTRAINT "client_case_publications_organisation_id_job_id_jobs_organisation_id_id_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assistant_threads" ADD CONSTRAINT "platform_assistant_threads_staff_id_platform_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_consent_records" ADD CONSTRAINT "ai_consent_records_uses_chk" CHECK (uses <@ array['field_proposals', 'photo_observation', 'document_extraction', 'report_prose', 'case_chat', 'business_chat', 'platform_chat']::text[]);--> statement-breakpoint
ALTER TABLE "ai_model_register" ADD CONSTRAINT "ai_model_register_uses_chk" CHECK (uses <@ array['field_proposals', 'photo_observation', 'document_extraction', 'report_prose', 'case_chat', 'business_chat', 'platform_chat']::text[]);--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_use_chk" CHECK (use in ('field_proposals', 'photo_observation', 'document_extraction', 'report_prose', 'case_chat', 'business_chat', 'platform_chat'));--> statement-breakpoint
ALTER TABLE "organisation_ai_settings" ADD CONSTRAINT "organisation_ai_settings_uses_chk" CHECK (permitted_uses <@ array['field_proposals', 'photo_observation', 'document_extraction', 'report_prose', 'case_chat', 'business_chat', 'platform_chat']::text[]);--> statement-breakpoint
ALTER TABLE client_case_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_case_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY client_case_publications_tenant ON client_case_publications USING (organisation_id = nullif(current_setting('app.current_organisation_id',true),'')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id',true),'')::uuid);
ALTER TABLE platform_assistant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_assistant_threads FORCE ROW LEVEL SECURITY;
