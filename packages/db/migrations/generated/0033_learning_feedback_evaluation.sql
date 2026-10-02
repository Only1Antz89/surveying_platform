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
ALTER TABLE "learning_case_feedback" ADD CONSTRAINT "learning_case_feedback_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_case_feedback" ADD CONSTRAINT "learning_case_feedback_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_restricted"."evaluation_runs" ADD CONSTRAINT "evaluation_runs_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "learning_restricted"."releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_case_feedback_case_idx" ON "learning_case_feedback" USING btree ("shared_case_id");--> statement-breakpoint
CREATE INDEX "learning_case_feedback_org_idx" ON "learning_case_feedback" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "learning_evaluation_runs_release_idx" ON "learning_restricted"."evaluation_runs" USING btree ("release_id","created_at");