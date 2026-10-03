CREATE TABLE "communication_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"template_id" uuid,
	"quote_id" uuid,
	"job_id" uuid,
	"channel" text DEFAULT 'email' NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"report_version_id" uuid NOT NULL,
	"document_id" uuid,
	"recipient" text NOT NULL,
	"delivery_method" text DEFAULT 'secure_link' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retention_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "holiday_dates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "customer_branding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "notification_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "communication_deliveries" ADD CONSTRAINT "communication_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_deliveries" ADD CONSTRAINT "communication_deliveries_template_id_communication_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."communication_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_deliveries" ADD CONSTRAINT "communication_deliveries_quote_id_customer_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."customer_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_deliveries" ADD CONSTRAINT "communication_deliveries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_document_id_organisation_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."organisation_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communication_deliveries_org_status_idx" ON "communication_deliveries" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "communication_deliveries_quote_idx" ON "communication_deliveries" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "report_deliveries_org_idx" ON "report_deliveries" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "report_deliveries_job_idx" ON "report_deliveries" USING btree ("job_id");
--> statement-breakpoint
DO $$ DECLARE tenant_table text; BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['communication_deliveries','report_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)', tenant_table || '_tenant_isolation', tenant_table);
  END LOOP;
END $$;
