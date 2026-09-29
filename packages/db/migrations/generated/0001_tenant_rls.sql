-- The application role has no BYPASSRLS privilege. Each request sets the
-- immutable internal organisation UUID for the duration of its transaction.
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'organisation_branding', 'organisation_memberships', 'invitations',
    'subscriptions', 'clients', 'properties', 'jobs', 'job_stage_events',
    'service_definitions', 'support_sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_tenant_read ON audit_events FOR SELECT
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
CREATE POLICY audit_events_tenant_insert ON audit_events FOR INSERT
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
