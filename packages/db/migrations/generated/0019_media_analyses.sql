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
ALTER TABLE "media_analyses" ADD CONSTRAINT "media_analyses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_analyses" ADD CONSTRAINT "media_analyses_media_fk" FOREIGN KEY ("organisation_id","media_id") REFERENCES "public"."media_assets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_analyses" ADD CONSTRAINT "media_analyses_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_analyses_media_analyser_uidx" ON "media_analyses" USING btree ("media_id","analyser");--> statement-breakpoint
CREATE INDEX "media_analyses_survey_idx" ON "media_analyses" USING btree ("organisation_id","survey_id");