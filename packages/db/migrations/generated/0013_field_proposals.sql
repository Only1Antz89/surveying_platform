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
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_element_fk" FOREIGN KEY ("organisation_id","element_id") REFERENCES "public"."survey_elements"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_proposals_dedupe_uidx" ON "field_proposals" USING btree ("survey_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "field_proposals_pending_idx" ON "field_proposals" USING btree ("survey_id","review_status");