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
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_overridden_by_user_id_users_id_fk" FOREIGN KEY ("overridden_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_overrides" ADD CONSTRAINT "completion_overrides_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completion_overrides_job_idx" ON "completion_overrides" USING btree ("organisation_id","job_id");