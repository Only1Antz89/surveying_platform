CREATE SCHEMA "learning_restricted";
--> statement-breakpoint
CREATE SCHEMA "learning_shared";
--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('inspected', 'partially_inspected', 'not_inspected', 'inaccessible', 'not_applicable');
--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('photo', 'document');
--> statement-breakpoint
CREATE TYPE "public"."observation_kind" AS ENUM('current_observation', 'measurement', 'client_claim', 'historical_reference', 'external_record');
--> statement-breakpoint
CREATE TYPE "public"."observation_status" AS ENUM('recorded', 'superseded', 'withdrawn');
--> statement-breakpoint
CREATE TYPE "public"."survey_status" AS ENUM('in_progress', 'in_review', 'approved', 'issued', 'withdrawn');
--> statement-breakpoint
CREATE TYPE "public"."value_origin" AS ENUM('surveyor_entry', 'accepted_proposal', 'edited_proposal', 'clerical_prefill');
--> statement-breakpoint
ALTER TYPE "public"."coverage_status" ADD VALUE 'not_covered';
--> statement-breakpoint
ALTER TYPE "public"."enrichment_status" ADD VALUE 'superseded';
--> statement-breakpoint
ALTER TYPE "public"."information_class" ADD VALUE 'indicative_external';
--> statement-breakpoint
ALTER TYPE "public"."location_confidence" ADD VALUE 'postcode_centroid';
--> statement-breakpoint
ALTER TYPE "public"."location_confidence" ADD VALUE 'geocoded_address';
--> statement-breakpoint
ALTER TYPE "public"."location_confidence" ADD VALUE 'surveyor_confirmed';
--> statement-breakpoint
ALTER TYPE "public"."platform_role" ADD VALUE 'privacy_reviewer';
--> statement-breakpoint
ALTER TYPE "public"."platform_role" ADD VALUE 'technical_reviewer';
--> statement-breakpoint
ALTER TYPE "public"."platform_role" ADD VALUE 'release_manager';
--> statement-breakpoint
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
CREATE TABLE "completion_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"category" text NOT NULL,
	"rule_id" text,
	"rule_set_key" text NOT NULL,
	"rule_set_version" text NOT NULL,
	"template_version" text NOT NULL,
	"target_stage" "job_stage" NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"overridden_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completion_overrides_reason_chk" CHECK (length(btrim(reason)) > 0)
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
CREATE TABLE "field_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"element_id" uuid,
	"field_path" text NOT NULL,
	"proposed_value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin_class" text NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"input_version" text NOT NULL,
	"base_value_id" uuid,
	"generator" text NOT NULL,
	"model_version" text DEFAULT 'none' NOT NULL,
	"prompt_version" text DEFAULT 'none' NOT NULL,
	"knowledge_version" text DEFAULT 'none' NOT NULL,
	"dedupe_key" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"review_note" text,
	"accepted_value_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_proposals_status_chk" CHECK (review_status in ('pending', 'accepted', 'edited', 'rejected', 'superseded')),
	CONSTRAINT "field_proposals_origin_chk" CHECK (origin_class in ('external_record', 'job_record', 'prior_survey', 'document_extraction', 'image_analysis', 'model_draft'))
);
--> statement-breakpoint
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
CREATE TABLE "learning_case_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"shared_case_id" uuid NOT NULL,
	"release_version" text NOT NULL,
	"rating" text NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_case_feedback_rating_chk" CHECK (rating in ('helpful', 'not_helpful', 'incorrect', 'identifying'))
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
CREATE TABLE "learning_restricted"."evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"method" text NOT NULL,
	"options" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"leakage" jsonb NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "learning_restricted"."release_items" (
	"release_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"shared_case_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"weight" double precision NOT NULL,
	"status" text DEFAULT 'included' NOT NULL,
	"status_reason" text,
	CONSTRAINT "learning_release_items_pk" PRIMARY KEY("release_id","candidate_id"),
	CONSTRAINT "release_items_shared_case_id_unique" UNIQUE("shared_case_id"),
	CONSTRAINT "learning_release_items_status_chk" CHECK (status in ('included', 'withdrawn', 'retracted')),
	CONSTRAINT "learning_release_items_weight_chk" CHECK (weight > 0 and weight <= 1)
);
--> statement-breakpoint
CREATE TABLE "learning_restricted"."releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"policy_version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	"privacy_signoff_staff_id" uuid,
	"privacy_signoff_at" timestamp with time zone,
	"privacy_note" text,
	"approved_by_staff_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_by_staff_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_version_unique" UNIQUE("version"),
	CONSTRAINT "learning_releases_status_chk" CHECK (status in ('draft', 'approved', 'active', 'superseded', 'rolled_back', 'retired')),
	CONSTRAINT "learning_releases_approval_chk" CHECK (status = 'draft' or (privacy_signoff_staff_id is not null and approved_by_staff_id is not null and approved_by_staff_id <> privacy_signoff_staff_id))
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
CREATE TABLE "media_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"survey_id" uuid,
	"analyser" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_analyses_status_chk" CHECK (status in ('completed', 'unavailable', 'failed'))
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
CREATE TABLE "price_paid_transactions" (
	"dataset_version_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"price" integer NOT NULL,
	"transfer_date" date NOT NULL,
	"property_type" text NOT NULL,
	"new_build" boolean NOT NULL,
	"tenure" text NOT NULL,
	"ppd_category" text NOT NULL,
	CONSTRAINT "price_paid_transactions_pk" PRIMARY KEY("dataset_version_id","transaction_id"),
	CONSTRAINT "price_paid_transactions_id_chk" CHECK (transaction_id ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
	CONSTRAINT "price_paid_transactions_price_chk" CHECK (price > 0),
	CONSTRAINT "price_paid_transactions_type_chk" CHECK (property_type in ('D', 'S', 'T', 'F', 'O')),
	CONSTRAINT "price_paid_transactions_tenure_chk" CHECK (tenure in ('F', 'L', 'U')),
	CONSTRAINT "price_paid_transactions_category_chk" CHECK (ppd_category in ('A', 'B'))
);
--> statement-breakpoint
CREATE TABLE "price_paid_uprn_links" (
	"dataset_version_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"uprn" text NOT NULL,
	CONSTRAINT "price_paid_uprn_links_pk" PRIMARY KEY("dataset_version_id","transaction_id","uprn"),
	CONSTRAINT "price_paid_uprn_links_id_chk" CHECK (transaction_id ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
	CONSTRAINT "price_paid_uprn_links_uprn_chk" CHECK (uprn ~ '^[0-9]{1,12}$')
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
CREATE TABLE "report_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"report_version_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"approver_role" text NOT NULL,
	"statement" text NOT NULL,
	"note" text,
	"content_sha256" text NOT NULL,
	"completion" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"composer" text NOT NULL,
	"template_key" text NOT NULL,
	"template_version" text NOT NULL,
	"template_fingerprint" text NOT NULL,
	"rule_set_version" text,
	"input_fingerprint" text NOT NULL,
	"content" jsonb NOT NULL,
	"trace" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_versions_org_id_uidx" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
CREATE TABLE "scottish_epc_certificates" (
	"dataset_version_id" uuid NOT NULL,
	"certificate_key" text NOT NULL,
	"uprn" text NOT NULL,
	"lodgement_date" date,
	"current_rating" text,
	"potential_rating" text,
	"property_type" text,
	"built_form" text,
	"construction_age_band" text,
	"total_floor_area_m2" double precision,
	CONSTRAINT "scottish_epc_certificates_pk" PRIMARY KEY("dataset_version_id","certificate_key"),
	CONSTRAINT "scottish_epc_certificates_uprn_chk" CHECK (uprn ~ '^[0-9]{1,12}$'),
	CONSTRAINT "scottish_epc_certificates_rating_chk" CHECK ((current_rating is null or current_rating ~ '^[A-G]$') and (potential_rating is null or potential_rating ~ '^[A-G]$'))
);
--> statement-breakpoint
CREATE TABLE "learning_shared"."cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"service_level" text NOT NULL,
	"template" text NOT NULL,
	"property_type" text,
	"built_form" text,
	"age_band" text,
	"element_key" text NOT NULL,
	"element_label" text NOT NULL,
	"inspection_status" text,
	"observed_feature" text NOT NULL,
	"possible_causes" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_cause" text,
	"confirmation_basis" text,
	"surveyor_judgement" text NOT NULL,
	"rating_example" text,
	"next_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	"limitations" text,
	"uncertainty" text NOT NULL,
	"evidence_strength" text NOT NULL,
	"knowledge_review_due" date NOT NULL,
	"rating_disagreement" boolean NOT NULL,
	"no_defect" boolean NOT NULL,
	"weight" double precision NOT NULL,
	"search_text" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, search_text)) STORED
);
--> statement-breakpoint
CREATE TABLE "learning_shared"."releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"case_count" integer NOT NULL,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "releases_version_unique" UNIQUE("version"),
	CONSTRAINT "shared_releases_status_chk" CHECK (status in ('active', 'inactive'))
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
	"jurisdiction" "property_country" NOT NULL,
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
CREATE TABLE "wording_clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"clause_key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"purpose" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"element_key" text,
	"condition_ratings" text[] DEFAULT '{}'::text[] NOT NULL,
	"next_actions" text[] DEFAULT '{}'::text[] NOT NULL,
	"inspection_statuses" text[] DEFAULT '{}'::text[] NOT NULL,
	"jurisdictions" text[] DEFAULT '{}'::text[] NOT NULL,
	"service_levels" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text DEFAULT 'firm_authored' NOT NULL,
	"licence_reference" text,
	"supersedes_id" uuid,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"retired_by_user_id" uuid,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wording_clauses_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "wording_clauses_status_chk" CHECK (status in ('draft', 'approved', 'retired')),
	CONSTRAINT "wording_clauses_purpose_chk" CHECK (purpose in ('element_narrative', 'recommendation', 'limitation', 'summary', 'legal_matter')),
	CONSTRAINT "wording_clauses_key_chk" CHECK (clause_key ~ '^[a-z0-9][a-z0-9_.-]{1,80}$'),
	CONSTRAINT "wording_clauses_source_chk" CHECK (source = 'firm_authored' or (source = 'licensed_third_party' and licence_reference is not null and length(btrim(licence_reference)) > 0)),
	CONSTRAINT "wording_clauses_approval_chk" CHECK (status = 'draft' or (approved_by_user_id is not null and approved_at is not null))
);
--> statement-breakpoint
DROP INDEX "dataset_versions_source_version_uidx";
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "locked_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "access_method" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "register_status" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "checked_at" date;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "definition" jsonb;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "licence_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "verified_by" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "verification_notes" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_success_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_failure_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_failure_code" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_probe_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_probe_status" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_probe_message" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_release_check_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_release_check_by" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "last_release_check_note" text;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD COLUMN "layer" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD COLUMN "source_crs" text;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD COLUMN "extent" text;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD COLUMN "imported_by" text;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD COLUMN "previous_active_id" uuid;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD COLUMN "completed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD COLUMN "retired_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD COLUMN "input_fingerprint" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD COLUMN "error" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "uprn_confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "uprn_evidence_type" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "identity_address_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD COLUMN "confidence_label" text;
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD COLUMN "message" text;
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD COLUMN "licence" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD COLUMN "input_fingerprint" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_org_id_uidx" UNIQUE("organisation_id","id");
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_uidx" UNIQUE("organisation_id","id");
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_org_id_uidx" UNIQUE("organisation_id","id");
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_org_id_uidx" UNIQUE("organisation_id","id");
--> statement-breakpoint
ALTER TABLE "address_lookups" ADD CONSTRAINT "address_lookups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "address_lookups" ADD CONSTRAINT "address_lookups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_consent_records" ADD CONSTRAINT "ai_consent_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_consent_records" ADD CONSTRAINT "ai_consent_records_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_consent_records" ADD CONSTRAINT "ai_consent_records_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_model_register" ADD CONSTRAINT "ai_model_register_approved_by_staff_id_platform_staff_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_tasks" ADD CONSTRAINT "assistant_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_tasks" ADD CONSTRAINT "assistant_tasks_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_tasks" ADD CONSTRAINT "assistant_tasks_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_overridden_by_user_id_users_id_fk" FOREIGN KEY ("overridden_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_element_fk" FOREIGN KEY ("organisation_id","element_id") REFERENCES "public"."survey_elements"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_case_feedback" ADD CONSTRAINT "learning_case_feedback_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_case_feedback" ADD CONSTRAINT "learning_case_feedback_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_contribution_grants" ADD CONSTRAINT "learning_contribution_grants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_contribution_grants" ADD CONSTRAINT "learning_contribution_grants_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_restricted"."evaluation_runs" ADD CONSTRAINT "evaluation_runs_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "learning_restricted"."releases"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_policy_versions" ADD CONSTRAINT "learning_policy_versions_published_by_staff_id_platform_staff_id_fk" FOREIGN KEY ("published_by_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_restricted"."release_items" ADD CONSTRAINT "release_items_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "learning_restricted"."releases"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_restricted"."release_items" ADD CONSTRAINT "release_items_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "learning_restricted"."candidates"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_restricted"."reviews" ADD CONSTRAINT "reviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "learning_restricted"."candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_restricted"."sanitisation_runs" ADD CONSTRAINT "sanitisation_runs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "learning_restricted"."candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_withdrawal_requests" ADD CONSTRAINT "learning_withdrawal_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_withdrawal_requests" ADD CONSTRAINT "learning_withdrawal_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_withdrawal_requests" ADD CONSTRAINT "learning_withdrawal_requests_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_analyses" ADD CONSTRAINT "media_analyses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_analyses" ADD CONSTRAINT "media_analyses_media_fk" FOREIGN KEY ("organisation_id","media_id") REFERENCES "public"."media_assets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_analyses" ADD CONSTRAINT "media_analyses_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_derived_fk" FOREIGN KEY ("organisation_id","derived_from_id") REFERENCES "public"."media_assets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_element_fk" FOREIGN KEY ("organisation_id","element_id") REFERENCES "public"."survey_elements"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organisation_ai_settings" ADD CONSTRAINT "organisation_ai_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organisation_ai_settings" ADD CONSTRAINT "organisation_ai_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "price_paid_transactions" ADD CONSTRAINT "price_paid_transactions_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "price_paid_uprn_links" ADD CONSTRAINT "price_paid_uprn_links_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_identity_events" ADD CONSTRAINT "property_identity_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_identity_events" ADD CONSTRAINT "property_identity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_identity_events" ADD CONSTRAINT "property_identity_events_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_version_fk" FOREIGN KEY ("organisation_id","report_version_id") REFERENCES "public"."report_versions"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scottish_epc_certificates" ADD CONSTRAINT "scottish_epc_certificates_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_shared"."cases" ADD CONSTRAINT "cases_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "learning_shared"."releases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "survey_elements" ADD CONSTRAINT "survey_elements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "survey_elements" ADD CONSTRAINT "survey_elements_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "survey_elements" ADD CONSTRAINT "survey_elements_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "survey_field_values" ADD CONSTRAINT "survey_field_values_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "survey_field_values" ADD CONSTRAINT "survey_field_values_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "survey_field_values" ADD CONSTRAINT "survey_field_values_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "address_lookups_cache_idx" ON "address_lookups" USING btree ("organisation_id","provider","query_hash","created_at");
--> statement-breakpoint
CREATE INDEX "address_lookups_expiry_idx" ON "address_lookups" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "ai_consent_records_job_idx" ON "ai_consent_records" USING btree ("organisation_id","job_id","created_at");
--> statement-breakpoint
CREATE INDEX "ai_incidents_org_status_idx" ON "ai_incidents" USING btree ("organisation_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_register_model_uidx" ON "ai_model_register" USING btree ("provider_key","model_id","model_version");
--> statement-breakpoint
CREATE INDEX "ai_risk_assessments_org_use_idx" ON "ai_risk_assessments" USING btree ("organisation_id","use","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_tasks_dedupe_uidx" ON "assistant_tasks" USING btree ("survey_id","dedupe_key");
--> statement-breakpoint
CREATE INDEX "assistant_tasks_open_idx" ON "assistant_tasks" USING btree ("survey_id","status");
--> statement-breakpoint
CREATE INDEX "completion_overrides_job_idx" ON "completion_overrides" USING btree ("organisation_id","job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_links_client_id_uidx" ON "evidence_links" USING btree ("organisation_id","client_generated_id");
--> statement-breakpoint
CREATE INDEX "evidence_links_target_idx" ON "evidence_links" USING btree ("survey_id","target_type","target_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "field_proposals_dedupe_uidx" ON "field_proposals" USING btree ("survey_id","dedupe_key");
--> statement-breakpoint
CREATE INDEX "field_proposals_pending_idx" ON "field_proposals" USING btree ("survey_id","review_status");
--> statement-breakpoint
CREATE INDEX "learning_audit_log_created_idx" ON "learning_restricted"."audit_log" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "learning_candidates_status_idx" ON "learning_restricted"."candidates" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "learning_candidates_org_idx" ON "learning_restricted"."candidates" USING btree ("organisation_id","scope","job_id");
--> statement-breakpoint
CREATE INDEX "learning_case_feedback_case_idx" ON "learning_case_feedback" USING btree ("shared_case_id");
--> statement-breakpoint
CREATE INDEX "learning_case_feedback_org_idx" ON "learning_case_feedback" USING btree ("organisation_id","created_at");
--> statement-breakpoint
CREATE INDEX "learning_contribution_grants_org_scope_idx" ON "learning_contribution_grants" USING btree ("organisation_id","scope","created_at");
--> statement-breakpoint
CREATE INDEX "learning_evaluation_runs_release_idx" ON "learning_restricted"."evaluation_runs" USING btree ("release_id","created_at");
--> statement-breakpoint
CREATE INDEX "learning_release_items_candidate_idx" ON "learning_restricted"."release_items" USING btree ("candidate_id");
--> statement-breakpoint
CREATE INDEX "learning_reviews_candidate_idx" ON "learning_restricted"."reviews" USING btree ("candidate_id","stage","created_at");
--> statement-breakpoint
CREATE INDEX "learning_sanitisation_runs_candidate_idx" ON "learning_restricted"."sanitisation_runs" USING btree ("candidate_id","created_at");
--> statement-breakpoint
CREATE INDEX "learning_sanitisation_runs_quasi_idx" ON "learning_restricted"."sanitisation_runs" USING btree ("quasi_key");
--> statement-breakpoint
CREATE INDEX "learning_withdrawal_requests_org_idx" ON "learning_withdrawal_requests" USING btree ("organisation_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "media_analyses_media_analyser_uidx" ON "media_analyses" USING btree ("media_id","analyser");
--> statement-breakpoint
CREATE INDEX "media_analyses_survey_idx" ON "media_analyses" USING btree ("organisation_id","survey_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_client_id_uidx" ON "media_assets" USING btree ("organisation_id","client_generated_id");
--> statement-breakpoint
CREATE INDEX "media_assets_survey_idx" ON "media_assets" USING btree ("survey_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "observations_client_id_uidx" ON "observations" USING btree ("organisation_id","client_generated_id");
--> statement-breakpoint
CREATE INDEX "observations_survey_idx" ON "observations" USING btree ("survey_id","status");
--> statement-breakpoint
CREATE INDEX "price_paid_uprn_links_uprn_idx" ON "price_paid_uprn_links" USING btree ("dataset_version_id","uprn");
--> statement-breakpoint
CREATE INDEX "property_identity_events_property_idx" ON "property_identity_events" USING btree ("property_id","created_at");
--> statement-breakpoint
CREATE INDEX "property_identity_events_org_idx" ON "property_identity_events" USING btree ("organisation_id");
--> statement-breakpoint
CREATE INDEX "provider_response_cache_expiry_idx" ON "provider_response_cache" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "provider_response_cache_source_idx" ON "provider_response_cache" USING btree ("source_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "report_approvals_version_uidx" ON "report_approvals" USING btree ("report_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "report_versions_survey_version_uidx" ON "report_versions" USING btree ("survey_id","version_number");
--> statement-breakpoint
CREATE INDEX "scottish_epc_certificates_uprn_idx" ON "scottish_epc_certificates" USING btree ("dataset_version_id","uprn");
--> statement-breakpoint
CREATE INDEX "shared_cases_release_element_idx" ON "learning_shared"."cases" USING btree ("release_id","element_key","jurisdiction");
--> statement-breakpoint
CREATE INDEX "shared_cases_search_idx" ON "learning_shared"."cases" USING gin ("search");
--> statement-breakpoint
CREATE UNIQUE INDEX "survey_elements_location_uidx" ON "survey_elements" USING btree ("survey_id","section_key","element_key","location_label");
--> statement-breakpoint
CREATE UNIQUE INDEX "survey_field_values_current_uidx" ON "survey_field_values" USING btree ("survey_id","field_path") WHERE superseded_at is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "survey_field_values_client_id_uidx" ON "survey_field_values" USING btree ("organisation_id","client_generated_id");
--> statement-breakpoint
CREATE INDEX "survey_field_values_history_idx" ON "survey_field_values" USING btree ("survey_id","field_path","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_active_job_uidx" ON "surveys" USING btree ("organisation_id","job_id") WHERE status <> 'withdrawn';
--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_client_id_uidx" ON "surveys" USING btree ("organisation_id","client_generated_id");
--> statement-breakpoint
CREATE INDEX "surveys_property_idx" ON "surveys" USING btree ("organisation_id","property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sync_operations_operation_uidx" ON "sync_operations" USING btree ("organisation_id","operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wording_clauses_key_version_uidx" ON "wording_clauses" USING btree ("organisation_id","clause_key","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "wording_clauses_one_approved_uidx" ON "wording_clauses" USING btree ("organisation_id","clause_key") WHERE status = 'approved';
--> statement-breakpoint
CREATE INDEX "wording_clauses_org_status_idx" ON "wording_clauses" USING btree ("organisation_id","status");
--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_run_fk" FOREIGN KEY ("organisation_id","enrichment_run_id") REFERENCES "public"."enrichment_runs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_versions_source_layer_version_uidx" ON "dataset_versions" USING btree ("source_key","layer","version");
--> statement-breakpoint
CREATE INDEX "os_uprn_points_location_geog_gix" ON "os_uprn_points" USING gist (("location"::geography));
--> statement-breakpoint
CREATE INDEX "property_intelligence_snapshots_property_idx" ON "property_intelligence_snapshots" USING btree ("property_id","source_key","category","retrieved_at");
--> statement-breakpoint
CREATE INDEX "property_intelligence_snapshots_run_idx" ON "property_intelligence_snapshots" USING btree ("enrichment_run_id");
--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_register_status_check" CHECK (register_status is null or register_status in ('verified', 'pending', 'blocked'));
