DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['organisation_ai_settings', 'ai_consent_records', 'ai_risk_assessments', 'ai_incidents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- The model register is platform data: every role may read it, only the owner (platform administration) may change it.
-- RLS is enabled without FORCE, so the table owner is unaffected and other roles get read access only.
ALTER TABLE ai_model_register ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_model_register_read ON ai_model_register FOR SELECT USING (true);
--> statement-breakpoint
-- Consent is a record of what was agreed and when; withdrawal is a new record, never an edit.
CREATE TRIGGER ai_consent_records_immutable
  BEFORE UPDATE OR DELETE ON ai_consent_records
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
-- An approved risk assessment can only be superseded; drafts stay editable.
CREATE OR REPLACE FUNCTION protect_ai_risk_assessments() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'approved risk assessments cannot be deleted';
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'superseded'
    AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'approved risk assessments are immutable; supersede with a new assessment';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_risk_assessments_protected
  BEFORE UPDATE OR DELETE ON ai_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION protect_ai_risk_assessments();
