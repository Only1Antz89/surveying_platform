ALTER TABLE media_analyses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE media_analyses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY media_analyses_tenant_isolation ON media_analyses FOR ALL
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
-- Append-only: an analysis is never edited. It is removed only with its media by the erasure routine.
CREATE OR REPLACE FUNCTION protect_append_only_erasable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.erasure', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_analyses_append_only
  BEFORE UPDATE OR DELETE ON media_analyses
  FOR EACH ROW EXECUTE FUNCTION protect_append_only_erasable();
