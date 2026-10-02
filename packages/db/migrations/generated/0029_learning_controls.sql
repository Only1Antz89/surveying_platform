CREATE SCHEMA "learning_restricted";
--> statement-breakpoint
ALTER TYPE "public"."platform_role" ADD VALUE 'privacy_reviewer';--> statement-breakpoint
ALTER TYPE "public"."platform_role" ADD VALUE 'technical_reviewer';--> statement-breakpoint
ALTER TYPE "public"."platform_role" ADD VALUE 'release_manager';--> statement-breakpoint
CREATE TABLE "learning_restricted"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_staff_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"organisation_id" uuid,
	"candidate_id" uuid,
	"release_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_restricted"."candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"contributor_key" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"element_id" uuid NOT NULL,
	"element_ref" text NOT NULL,
	"scope" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"dedup_key" text NOT NULL,
	"group_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_source_fingerprint_unique" UNIQUE("source_fingerprint"),
	CONSTRAINT "learning_candidates_scope_chk" CHECK (scope in ('structured_cases', 'photos', 'evaluation', 'model_training')),
	CONSTRAINT "learning_candidates_status_chk" CHECK (status in ('awaiting_privacy_review', 'quarantined', 'awaiting_technical_review', 'approved', 'released', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "learning_contribution_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"policy_version" text NOT NULL,
	"confirmations" text[] DEFAULT '{}'::text[] NOT NULL,
	"basis" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_contribution_grants_scope_chk" CHECK (scope in ('structured_cases', 'photos', 'evaluation', 'model_training')),
	CONSTRAINT "learning_contribution_grants_status_chk" CHECK (status in ('granted', 'revoked')),
	CONSTRAINT "learning_contribution_grants_confirmed_chk" CHECK (status = 'revoked' or (confirmations @> array['client_information_authority', 'third_party_rights', 'policy_accepted']::text[] and basis is not null and length(btrim(basis)) >= 10))
);
--> statement-breakpoint
CREATE TABLE "learning_restricted"."contributors" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"contributor_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributors_contributor_key_unique" UNIQUE("contributor_key")
);
--> statement-breakpoint
CREATE TABLE "learning_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"summary" text NOT NULL,
	"policy_document_ref" text NOT NULL,
	"privacy_assessment_ref" text,
	"release_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_by_staff_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_policy_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "learning_policy_versions_status_chk" CHECK (status in ('draft', 'published', 'retired')),
	CONSTRAINT "learning_policy_versions_published_chk" CHECK (status = 'draft' or (published_at is not null and privacy_assessment_ref is not null))
);
--> statement-breakpoint
CREATE TABLE "learning_restricted"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"reviewer_staff_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"checks" text[] DEFAULT '{}'::text[] NOT NULL,
	"reviewed" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_reviews_stage_chk" CHECK (stage in ('privacy', 'technical')),
	CONSTRAINT "learning_reviews_decision_chk" CHECK (decision in ('approved', 'rejected')),
	CONSTRAINT "learning_reviews_reviewed_chk" CHECK (stage = 'privacy' or decision = 'rejected' or reviewed is not null)
);
--> statement-breakpoint
CREATE TABLE "learning_restricted"."sanitisation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"transformer" text NOT NULL,
	"output" jsonb NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"residual_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"quasi_key" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_sanitisation_runs_outcome_chk" CHECK (outcome in ('passed', 'quarantined'))
);
--> statement-breakpoint
CREATE TABLE "learning_withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"scope" text,
	"job_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"outcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "learning_withdrawal_requests_scope_chk" CHECK (scope is null or scope in ('structured_cases', 'photos', 'evaluation', 'model_training')),
	CONSTRAINT "learning_withdrawal_requests_status_chk" CHECK (status in ('requested', 'completed')),
	CONSTRAINT "learning_withdrawal_requests_completed_chk" CHECK (status = 'requested' or completed_at is not null)
);
--> statement-breakpoint
ALTER TABLE "learning_contribution_grants" ADD CONSTRAINT "learning_contribution_grants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_contribution_grants" ADD CONSTRAINT "learning_contribution_grants_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_policy_versions" ADD CONSTRAINT "learning_policy_versions_published_by_staff_id_platform_staff_id_fk" FOREIGN KEY ("published_by_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_restricted"."reviews" ADD CONSTRAINT "reviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "learning_restricted"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_restricted"."sanitisation_runs" ADD CONSTRAINT "sanitisation_runs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "learning_restricted"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_withdrawal_requests" ADD CONSTRAINT "learning_withdrawal_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_withdrawal_requests" ADD CONSTRAINT "learning_withdrawal_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_withdrawal_requests" ADD CONSTRAINT "learning_withdrawal_requests_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_audit_log_created_idx" ON "learning_restricted"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "learning_candidates_status_idx" ON "learning_restricted"."candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "learning_candidates_org_idx" ON "learning_restricted"."candidates" USING btree ("organisation_id","scope","job_id");--> statement-breakpoint
CREATE INDEX "learning_contribution_grants_org_scope_idx" ON "learning_contribution_grants" USING btree ("organisation_id","scope","created_at");--> statement-breakpoint
CREATE INDEX "learning_reviews_candidate_idx" ON "learning_restricted"."reviews" USING btree ("candidate_id","stage","created_at");--> statement-breakpoint
CREATE INDEX "learning_sanitisation_runs_candidate_idx" ON "learning_restricted"."sanitisation_runs" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "learning_sanitisation_runs_quasi_idx" ON "learning_restricted"."sanitisation_runs" USING btree ("quasi_key");--> statement-breakpoint
CREATE INDEX "learning_withdrawal_requests_org_idx" ON "learning_withdrawal_requests" USING btree ("organisation_id","status");