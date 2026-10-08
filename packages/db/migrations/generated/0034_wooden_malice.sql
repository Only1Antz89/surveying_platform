CREATE TABLE "preinspection_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preinspection_drafts_version_chk" CHECK (version >= 0)
);
--> statement-breakpoint
CREATE TABLE "preinspection_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text DEFAULT 'preinspection' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preinspection_links_purpose_chk" CHECK (purpose = 'preinspection')
);
--> statement-breakpoint
CREATE TABLE "preinspection_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preinspection_submissions_source_chk" CHECK (source in ('customer', 'staff_transcribed_client')),
	CONSTRAINT "preinspection_submissions_version_chk" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "survey_evidence_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preinspection_drafts" ADD CONSTRAINT "preinspection_drafts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_drafts" ADD CONSTRAINT "preinspection_drafts_organisation_id_job_id_jobs_organisation_id_id_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_drafts" ADD CONSTRAINT "preinspection_drafts_organisation_id_property_id_properties_organisation_id_id_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_links" ADD CONSTRAINT "preinspection_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_links" ADD CONSTRAINT "preinspection_links_quote_id_customer_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."customer_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_links" ADD CONSTRAINT "preinspection_links_organisation_id_job_id_jobs_organisation_id_id_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_submissions" ADD CONSTRAINT "preinspection_submissions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_submissions" ADD CONSTRAINT "preinspection_submissions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_submissions" ADD CONSTRAINT "preinspection_submissions_organisation_id_job_id_jobs_organisation_id_id_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_submissions" ADD CONSTRAINT "preinspection_submissions_organisation_id_property_id_properties_organisation_id_id_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preinspection_drafts_org_job_uidx" ON "preinspection_drafts" USING btree ("organisation_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preinspection_links_hash_uidx" ON "preinspection_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "preinspection_links_org_job_idx" ON "preinspection_links" USING btree ("organisation_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preinspection_submissions_org_job_version_uidx" ON "preinspection_submissions" USING btree ("organisation_id","job_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "preinspection_submissions_request_uidx" ON "preinspection_submissions" USING btree ("organisation_id","job_id","request_id");
--> statement-breakpoint
ALTER TABLE preinspection_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE preinspection_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY preinspection_drafts_tenant ON preinspection_drafts USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE preinspection_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE preinspection_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY preinspection_submissions_tenant ON preinspection_submissions USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE preinspection_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE preinspection_links FORCE ROW LEVEL SECURITY;
CREATE POLICY preinspection_links_tenant ON preinspection_links USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
CREATE FUNCTION reject_preinspection_submission_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submitted customer statements are immutable; create a correction version';
END;
$$;
CREATE TRIGGER preinspection_submissions_immutable BEFORE UPDATE OR DELETE ON preinspection_submissions FOR EACH ROW EXECUTE FUNCTION reject_preinspection_submission_changes();
