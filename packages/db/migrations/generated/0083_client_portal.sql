CREATE TABLE "client_portal_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"email" text,
	"token_hash" text NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" uuid,
	"last_sent_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_access_source_chk" CHECK ("client_portal_access"."source" in ('quote_accepted','practice_sent','practice_link'))
);
--> statement-breakpoint
CREATE TABLE "client_portal_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"shared_by_user_id" uuid,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "client_portal_files_category_chk" CHECK ("client_portal_files"."category" in ('photo','video','certificate','document')),
	CONSTRAINT "client_portal_files_title_chk" CHECK (length(btrim(title)) between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_files" ADD CONSTRAINT "client_portal_files_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_files" ADD CONSTRAINT "client_portal_files_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_files" ADD CONSTRAINT "client_portal_files_shared_by_user_id_users_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_files" ADD CONSTRAINT "client_portal_files_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_access_token_uidx" ON "client_portal_access" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_access_active_job_uidx" ON "client_portal_access" USING btree ("organisation_id","job_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_files_active_uidx" ON "client_portal_files" USING btree ("organisation_id","job_id","media_asset_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "client_portal_files_job_idx" ON "client_portal_files" USING btree ("organisation_id","job_id");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_portal_access','client_portal_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organisation_id=nullif(current_setting(''app.current_organisation_id'',true),'''')::uuid) WITH CHECK (organisation_id=nullif(current_setting(''app.current_organisation_id'',true),'''')::uuid)', t || '_tenant', t);
  END LOOP;
END $$;
