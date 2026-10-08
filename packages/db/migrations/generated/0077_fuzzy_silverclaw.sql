CREATE TABLE "job_site_statuses" (
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_site_statuses_organisation_id_job_id_pk" PRIMARY KEY("organisation_id","job_id"),
	CONSTRAINT "job_site_statuses_status" CHECK ("job_site_statuses"."status" in ('en_route','on_site','left_site'))
);
--> statement-breakpoint
ALTER TABLE "job_site_statuses" ADD CONSTRAINT "job_site_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_site_statuses" ADD CONSTRAINT "job_site_statuses_organisation_id_job_id_jobs_organisation_id_id_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE job_site_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_site_statuses FORCE ROW LEVEL SECURITY;
CREATE POLICY job_site_statuses_tenant ON job_site_statuses USING (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid) WITH CHECK (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid);
