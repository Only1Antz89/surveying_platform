DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['enrichment_runs', 'property_intelligence_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- Snapshots record what a source said at retrieval time; they are never edited.
CREATE TRIGGER property_intelligence_snapshots_immutable
  BEFORE UPDATE OR DELETE ON property_intelligence_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
GRANT SELECT ON reference.spatial_features TO surveynt_reference_read;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON reference.spatial_features TO surveynt_reference_write;
