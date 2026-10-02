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
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_version_fk" FOREIGN KEY ("organisation_id","report_version_id") REFERENCES "public"."report_versions"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wording_clauses" ADD CONSTRAINT "wording_clauses_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_approvals_version_uidx" ON "report_approvals" USING btree ("report_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_versions_survey_version_uidx" ON "report_versions" USING btree ("survey_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "wording_clauses_key_version_uidx" ON "wording_clauses" USING btree ("organisation_id","clause_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "wording_clauses_one_approved_uidx" ON "wording_clauses" USING btree ("organisation_id","clause_key") WHERE status = 'approved';--> statement-breakpoint
CREATE INDEX "wording_clauses_org_status_idx" ON "wording_clauses" USING btree ("organisation_id","status");