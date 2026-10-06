CREATE TABLE "website_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"reference" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"reason" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_form_drafts" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"active_version_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_form_rate_windows" (
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "website_form_rate_windows_organisation_id_key_pk" PRIMARY KEY("organisation_id","key")
);
--> statement-breakpoint
CREATE TABLE "website_form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"published_by_user_id" uuid,
	"restored_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_form_versions_org_id_uidx" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
ALTER TABLE "website_enquiries" ADD CONSTRAINT "website_enquiries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_enquiries" ADD CONSTRAINT "website_enquiries_organisation_id_form_version_id_website_form_versions_organisation_id_id_fk" FOREIGN KEY ("organisation_id","form_version_id") REFERENCES "public"."website_form_versions"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_form_drafts" ADD CONSTRAINT "website_form_drafts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_form_drafts" ADD CONSTRAINT "website_form_drafts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_form_rate_windows" ADD CONSTRAINT "website_form_rate_windows_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_form_versions" ADD CONSTRAINT "website_form_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_form_versions" ADD CONSTRAINT "website_form_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "website_enquiries_request_uidx" ON "website_enquiries" USING btree ("organisation_id","request_id");--> statement-breakpoint
CREATE INDEX "website_enquiries_created_idx" ON "website_enquiries" USING btree ("organisation_id","created_at");
--> statement-breakpoint
ALTER TABLE website_form_drafts ADD CONSTRAINT website_form_active_version_fk FOREIGN KEY (organisation_id, active_version_id) REFERENCES website_form_versions(organisation_id,id);
ALTER TABLE website_form_versions ADD CONSTRAINT website_form_restore_fk FOREIGN KEY (organisation_id, restored_from_id) REFERENCES website_form_versions(organisation_id,id);
ALTER TABLE website_enquiries ADD CONSTRAINT website_enquiries_status_chk CHECK (status IN ('new','contacted','closed'));
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['website_form_drafts','website_form_versions','website_enquiries','website_form_rate_windows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)', t || '_tenant', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION website_form_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published website form versions are immutable'; END $$;
CREATE TRIGGER website_form_version_immutable BEFORE UPDATE OR DELETE ON website_form_versions FOR EACH ROW EXECUTE FUNCTION website_form_version_immutable();
