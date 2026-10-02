ALTER TABLE completion_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE completion_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY completion_overrides_tenant_isolation ON completion_overrides FOR ALL
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
-- An override records a professional decision at a point in time; it is never edited or removed.
CREATE TRIGGER completion_overrides_immutable
  BEFORE UPDATE OR DELETE ON completion_overrides
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
