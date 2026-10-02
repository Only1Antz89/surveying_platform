ALTER TABLE "reference"."data_sources" ADD COLUMN "last_probe_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reference"."data_sources" ADD COLUMN "last_probe_status" text;--> statement-breakpoint
ALTER TABLE "reference"."data_sources" ADD COLUMN "last_probe_message" text;--> statement-breakpoint
ALTER TABLE "reference"."data_sources" ADD COLUMN "last_release_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reference"."data_sources" ADD COLUMN "last_release_check_by" text;--> statement-breakpoint
ALTER TABLE "reference"."data_sources" ADD COLUMN "last_release_check_note" text;