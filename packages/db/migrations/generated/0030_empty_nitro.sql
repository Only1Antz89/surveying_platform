CREATE TABLE "settlement_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"total_minor" integer NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_batch_items" ADD CONSTRAINT "settlement_batch_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch_items" ADD CONSTRAINT "settlement_batch_items_batch_id_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."settlement_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch_items" ADD CONSTRAINT "settlement_batch_items_ledger_entry_id_settlement_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."settlement_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_batch_items_ledger_uidx" ON "settlement_batch_items" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "settlement_batch_items_batch_idx" ON "settlement_batch_items" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_batches_org_reference_uidx" ON "settlement_batches" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE INDEX "settlement_batches_org_time_idx" ON "settlement_batches" USING btree ("organisation_id","settled_at");
--> statement-breakpoint
DO $$ DECLARE tenant_table text; BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['settlement_batches','settlement_batch_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)', tenant_table || '_tenant_isolation', tenant_table);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE settlement_batches ADD CONSTRAINT settlement_batches_total_chk CHECK (total_minor > 0);
--> statement-breakpoint
CREATE TRIGGER settlement_batches_immutable BEFORE UPDATE OR DELETE ON settlement_batches FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER settlement_batch_items_immutable BEFORE UPDATE OR DELETE ON settlement_batch_items FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
