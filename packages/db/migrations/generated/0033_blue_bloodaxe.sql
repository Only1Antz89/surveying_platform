ALTER TYPE "public"."organisation_role" ADD VALUE 'manager' BEFORE 'surveyor';--> statement-breakpoint
ALTER TABLE "organisation_memberships" ADD COLUMN "can_record_survey" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_memberships" ADD COLUMN "can_approve_reports" boolean DEFAULT false NOT NULL;