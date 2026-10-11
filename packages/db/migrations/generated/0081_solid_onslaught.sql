ALTER TYPE "public"."media_kind" ADD VALUE 'video';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "survey_file_archive_until" timestamp with time zone;