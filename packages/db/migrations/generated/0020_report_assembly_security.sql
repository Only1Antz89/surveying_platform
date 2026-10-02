DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['wording_clauses', 'report_versions', 'report_approvals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- Drafts are editable and deletable. Approved wording never changes: it can only be retired, and a new version supersedes it.
CREATE OR REPLACE FUNCTION protect_wording_clauses() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'approved or retired wording cannot be deleted';
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'retired'
    AND (to_jsonb(NEW) - 'status' - 'retired_at' - 'retired_by_user_id' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'retired_at' - 'retired_by_user_id' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'approved wording is immutable; create a new version';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER wording_clauses_protected
  BEFORE UPDATE OR DELETE ON wording_clauses
  FOR EACH ROW EXECUTE FUNCTION protect_wording_clauses();
--> statement-breakpoint
-- A composed report version and its sign-off record what was produced and approved; neither is ever edited.
CREATE TRIGGER report_versions_immutable
  BEFORE UPDATE OR DELETE ON report_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER report_approvals_immutable
  BEFORE UPDATE OR DELETE ON report_approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
