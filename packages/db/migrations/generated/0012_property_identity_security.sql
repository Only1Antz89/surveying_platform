-- Reference data lives in the England release's public tables (migration 0006),
-- readable by every role through their SELECT policies. Importers
-- (surveynt_reference_write) also write versions, logs and rows; enabling a
-- source stays an owner or platform action.
GRANT SELECT ON data_sources TO surveynt_reference_read, surveynt_reference_write;
--> statement-breakpoint
GRANT SELECT ON dataset_versions, dataset_syncs, os_uprn_points, spatial_reference_features, price_paid_transactions, price_paid_uprn_links, scottish_epc_certificates TO surveynt_reference_read;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON dataset_versions, dataset_syncs, os_uprn_points, spatial_reference_features, price_paid_transactions, price_paid_uprn_links, scottish_epc_certificates TO surveynt_reference_write;
--> statement-breakpoint
ALTER TABLE price_paid_transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY price_paid_transactions_read_policy ON price_paid_transactions FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE price_paid_uprn_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY price_paid_uprn_links_read_policy ON price_paid_uprn_links FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE scottish_epc_certificates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scottish_epc_certificates_read_policy ON scottish_epc_certificates FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY dataset_versions_importer_write ON dataset_versions FOR ALL TO surveynt_reference_write USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dataset_syncs_importer_write ON dataset_syncs FOR ALL TO surveynt_reference_write USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY os_uprn_points_importer_write ON os_uprn_points FOR ALL TO surveynt_reference_write USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY spatial_reference_features_importer_write ON spatial_reference_features FOR ALL TO surveynt_reference_write USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY price_paid_transactions_importer_write ON price_paid_transactions FOR ALL TO surveynt_reference_write USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY price_paid_uprn_links_importer_write ON price_paid_uprn_links FOR ALL TO surveynt_reference_write USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY scottish_epc_certificates_importer_write ON scottish_epc_certificates FOR ALL TO surveynt_reference_write USING (true) WITH CHECK (true);
--> statement-breakpoint
-- One active version per source and layer (the England release allowed one per source;
-- its sources all use the default empty layer, so they behave exactly as before).
DROP INDEX IF EXISTS dataset_versions_one_active_per_source_uidx;
--> statement-breakpoint
CREATE UNIQUE INDEX dataset_versions_one_active_per_layer_uidx ON dataset_versions (source_key, layer) WHERE active = true;
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
