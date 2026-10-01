-- Reference data is global and read-only for tenant traffic.
REVOKE ALL ON SCHEMA reference FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA reference TO surveynt_reference_read, surveynt_reference_write;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA reference TO surveynt_reference_read;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA reference GRANT SELECT ON TABLES TO surveynt_reference_read;
--> statement-breakpoint
-- Importers load reference rows and record syncs; enabling a source stays an owner/platform action.
GRANT SELECT ON reference.data_sources TO surveynt_reference_write;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON reference.dataset_syncs, reference.os_open_uprn TO surveynt_reference_write;
--> statement-breakpoint
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['property_identity_events', 'address_lookups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER property_identity_events_immutable
  BEFORE UPDATE OR DELETE ON property_identity_events
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
