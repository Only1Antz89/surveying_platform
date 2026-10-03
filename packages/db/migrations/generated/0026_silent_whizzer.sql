CREATE TYPE "public"."appointment_status" AS ENUM('provisional', 'confirmed', 'completed', 'cancelled', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'part_paid', 'paid', 'void', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'issued', 'viewed', 'accepted', 'expired', 'cancelled', 'converted');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"quote_id" uuid,
	"surveyor_id" uuid,
	"status" "appointment_status" DEFAULT 'provisional' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'blocked' NOT NULL,
	"reason" text,
	"source" text DEFAULT 'surveynt' NOT NULL,
	"external_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"appointment_id" uuid,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"sync_cursor" text,
	"webhook_channel_id" text,
	"webhook_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"quote_id" uuid,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"purpose" text NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"amount_minor" integer NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_payments_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "client_payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "communication_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"service_definition_id" uuid,
	"pricing_version_id" uuid,
	"reference" text NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"property_address" text,
	"city" text,
	"postcode" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommendation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pricing_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"deposit_minor" integer NOT NULL,
	"access_token_hash" text NOT NULL,
	"token_revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"client_id" uuid,
	"property_id" uuid,
	"job_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_minor" integer NOT NULL,
	"vat_basis_points" integer DEFAULT 2000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"quote_id" uuid,
	"number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"due_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid,
	"report_version_id" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"access_class" text DEFAULT 'firm' NOT NULL,
	"blob_url" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"checksum" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"retention_until" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"uploaded_by_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_operational_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"office_address" text,
	"office_latitude" double precision,
	"office_longitude" double precision,
	"working_days" jsonb DEFAULT '["monday","tuesday","wednesday","thursday","friday"]'::jsonb NOT NULL,
	"working_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booking_horizon_days" integer DEFAULT 90 NOT NULL,
	"travel_buffer_minutes" integer DEFAULT 30 NOT NULL,
	"mileage_rate_pence" integer DEFAULT 45 NOT NULL,
	"document_retention_days" integer DEFAULT 2555 NOT NULL,
	"public_quotes_enabled" boolean DEFAULT false NOT NULL,
	"client_payments_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"event" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_pricing_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"service_definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"base_amount_minor" integer NOT NULL,
	"vat_basis_points" integer DEFAULT 2000 NOT NULL,
	"deposit_basis_points" integer DEFAULT 1000 NOT NULL,
	"duration_minutes" integer DEFAULT 180 NOT NULL,
	"validity_days" integer DEFAULT 7 NOT NULL,
	"surcharges" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommendation_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"payment_id" uuid,
	"entry_type" text NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"amount_minor" integer NOT NULL,
	"external_settlement_reference" text,
	"settled_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_quote_id_customer_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."customer_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_surveyor_id_users_id_fk" FOREIGN KEY ("surveyor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_conflicts" ADD CONSTRAINT "calendar_conflicts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_conflicts" ADD CONSTRAINT "calendar_conflicts_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_conflicts" ADD CONSTRAINT "calendar_conflicts_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_conflicts" ADD CONSTRAINT "calendar_conflicts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payments" ADD CONSTRAINT "client_payments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payments" ADD CONSTRAINT "client_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payments" ADD CONSTRAINT "client_payments_quote_id_customer_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."customer_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_quotes" ADD CONSTRAINT "customer_quotes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_quotes" ADD CONSTRAINT "customer_quotes_service_definition_id_service_definitions_id_fk" FOREIGN KEY ("service_definition_id") REFERENCES "public"."service_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_quotes" ADD CONSTRAINT "customer_quotes_pricing_version_id_service_pricing_versions_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."service_pricing_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_quotes" ADD CONSTRAINT "customer_quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_quotes" ADD CONSTRAINT "customer_quotes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_quotes" ADD CONSTRAINT "customer_quotes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_id_customer_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."customer_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_documents" ADD CONSTRAINT "organisation_documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_documents" ADD CONSTRAINT "organisation_documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_documents" ADD CONSTRAINT "organisation_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD CONSTRAINT "organisation_operational_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_quote_id_customer_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."customer_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_pricing_versions" ADD CONSTRAINT "service_pricing_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_pricing_versions" ADD CONSTRAINT "service_pricing_versions_service_definition_id_service_definitions_id_fk" FOREIGN KEY ("service_definition_id") REFERENCES "public"."service_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_pricing_versions" ADD CONSTRAINT "service_pricing_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_ledger" ADD CONSTRAINT "settlement_ledger_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_ledger" ADD CONSTRAINT "settlement_ledger_payment_id_client_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."client_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_ledger" ADD CONSTRAINT "settlement_ledger_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_org_time_idx" ON "appointments" USING btree ("organisation_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_quote_uidx" ON "appointments" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "availability_blocks_org_time_idx" ON "availability_blocks" USING btree ("organisation_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "calendar_conflicts_org_status_idx" ON "calendar_conflicts" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_provider_account_uidx" ON "calendar_connections" USING btree ("organisation_id","provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "calendar_connections_user_idx" ON "calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "client_payments_org_status_idx" ON "client_payments" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "client_payments_invoice_idx" ON "client_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_templates_org_key_version_uidx" ON "communication_templates" USING btree ("organisation_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_quotes_org_reference_uidx" ON "customer_quotes" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_quotes_token_hash_uidx" ON "customer_quotes" USING btree ("access_token_hash");--> statement-breakpoint
CREATE INDEX "customer_quotes_org_status_idx" ON "customer_quotes" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_uidx" ON "invoices" USING btree ("organisation_id","number");--> statement-breakpoint
CREATE INDEX "invoices_job_idx" ON "invoices" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "organisation_documents_org_category_idx" ON "organisation_documents" USING btree ("organisation_id","category");--> statement-breakpoint
CREATE INDEX "organisation_documents_job_idx" ON "organisation_documents" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_operational_settings_org_uidx" ON "organisation_operational_settings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "quote_snapshots_quote_idx" ON "quote_snapshots" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_snapshots_org_idx" ON "quote_snapshots" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_pricing_versions_service_version_uidx" ON "service_pricing_versions" USING btree ("service_definition_id","version");--> statement-breakpoint
CREATE INDEX "service_pricing_versions_org_idx" ON "service_pricing_versions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "settlement_ledger_org_time_idx" ON "settlement_ledger" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "settlement_ledger_payment_idx" ON "settlement_ledger" USING btree ("payment_id");
--> statement-breakpoint
-- Every operations table is tenant-owned. The application role must set the
-- organisation context in the same transaction before reading or writing.
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'organisation_operational_settings','service_pricing_versions','customer_quotes','quote_snapshots',
    'availability_blocks','appointments','calendar_connections','calendar_conflicts','invoices',
    'invoice_line_items','client_payments','settlement_ledger','organisation_documents','communication_templates'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organisation_operational_settings ADD CONSTRAINT organisation_operational_settings_coordinates_pair_chk CHECK ((office_latitude IS NULL) = (office_longitude IS NULL));
--> statement-breakpoint
ALTER TABLE service_pricing_versions ADD CONSTRAINT service_pricing_versions_money_chk CHECK (base_amount_minor >= 0 AND vat_basis_points BETWEEN 0 AND 10000 AND deposit_basis_points BETWEEN 0 AND 10000 AND duration_minutes > 0 AND validity_days BETWEEN 1 AND 365);
--> statement-breakpoint
ALTER TABLE customer_quotes ADD CONSTRAINT customer_quotes_money_chk CHECK (subtotal_minor >= 0 AND vat_minor >= 0 AND total_minor = subtotal_minor + vat_minor AND deposit_minor BETWEEN 0 AND total_minor);
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_time_chk CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE availability_blocks ADD CONSTRAINT availability_blocks_time_chk CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE client_payments ADD CONSTRAINT client_payments_amount_chk CHECK (amount_minor > 0 AND refunded_minor BETWEEN 0 AND amount_minor);
--> statement-breakpoint
-- Accepted pricing evidence and financial history are append-only. Corrections
-- use a new snapshot or ledger entry instead of rewriting the audit trail.
CREATE TRIGGER quote_snapshots_immutable BEFORE UPDATE OR DELETE ON quote_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER settlement_ledger_immutable BEFORE UPDATE OR DELETE ON settlement_ledger FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
