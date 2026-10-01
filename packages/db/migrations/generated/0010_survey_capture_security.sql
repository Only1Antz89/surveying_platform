DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'surveys', 'survey_elements', 'survey_field_values', 'observations',
    'media_assets', 'evidence_links', 'assistant_tasks', 'sync_operations'
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
-- Field value history is append-only. The only permitted change is marking the
-- current row superseded. Deletion requires the audited erasure routine, which
-- sets app.erasure for its own transaction.
CREATE OR REPLACE FUNCTION protect_field_value_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.erasure', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'survey field values are append-only';
  END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
    OR (to_jsonb(NEW) - 'superseded_at') <> (to_jsonb(OLD) - 'superseded_at') THEN
    RAISE EXCEPTION 'survey field values are append-only; insert a superseding value instead';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER survey_field_values_append_only
  BEFORE UPDATE OR DELETE ON survey_field_values
  FOR EACH ROW EXECUTE FUNCTION protect_field_value_history();
--> statement-breakpoint
-- Original media are immutable: only status and deleted_at may change.
CREATE OR REPLACE FUNCTION protect_media_originals() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.erasure', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'media assets cannot be deleted outside the erasure routine';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'deleted_at') <> (to_jsonb(OLD) - 'status' - 'deleted_at') THEN
    RAISE EXCEPTION 'media assets are immutable; store an annotated or processed version as a new derived asset';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_assets_immutable
  BEFORE UPDATE OR DELETE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION protect_media_originals();
