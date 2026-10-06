ALTER TABLE "field_proposals" DROP CONSTRAINT "field_proposals_origin_chk";--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "report_identity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "report_name" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "report_contact" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_origin_chk" CHECK (origin_class in ('external_record', 'job_record', 'practice_record', 'customer_statement', 'prior_survey', 'document_extraction', 'image_analysis', 'model_draft'));