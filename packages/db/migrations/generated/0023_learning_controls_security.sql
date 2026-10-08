-- Firm contribution grants and withdrawal requests are tenant data.
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['learning_contribution_grants', 'learning_withdrawal_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.current_organisation_id'', true), '''')::uuid)',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- A grant or revocation is a record of what the firm confirmed and when; a change is a new record.
CREATE TRIGGER learning_contribution_grants_immutable
  BEFORE UPDATE OR DELETE ON learning_contribution_grants
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
-- A withdrawal request can only move from requested to completed, recording its outcome; it is never deleted.
CREATE OR REPLACE FUNCTION protect_learning_withdrawals() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'withdrawal requests cannot be deleted'; END IF;
  IF OLD.status = 'requested' AND NEW.status = 'completed'
    AND (to_jsonb(NEW) - 'status' - 'outcome' - 'completed_at') = (to_jsonb(OLD) - 'status' - 'outcome' - 'completed_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'withdrawal requests can only be completed';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_withdrawal_requests_protected
  BEFORE UPDATE OR DELETE ON learning_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION protect_learning_withdrawals();
--> statement-breakpoint
-- Policy versions are platform data: readable by every role, written only by the owner (platform administration).
ALTER TABLE learning_policy_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY learning_policy_versions_read ON learning_policy_versions FOR SELECT USING (true);
--> statement-breakpoint
-- A published policy cannot be rewritten, only retired; drafts stay editable.
CREATE OR REPLACE FUNCTION protect_learning_policy_versions() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'published policy versions cannot be deleted';
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'published' AND NEW.status = 'retired'
    AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published policy versions are immutable; publish a new version';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_policy_versions_protected
  BEFORE UPDATE OR DELETE ON learning_policy_versions
  FOR EACH ROW EXECUTE FUNCTION protect_learning_policy_versions();
--> statement-breakpoint
-- At most one published policy at a time.
CREATE UNIQUE INDEX learning_policy_versions_one_published_uidx ON learning_policy_versions ((status)) WHERE status = 'published';
--> statement-breakpoint
-- Group roles (NOLOGIN). The learning service's login role is granted
-- surveynt_learning_write; the tenant application role is never granted it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surveynt_learning_write') THEN
    CREATE ROLE surveynt_learning_write NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surveynt_learning_read') THEN
    CREATE ROLE surveynt_learning_read NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA learning_restricted FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA learning_restricted TO surveynt_learning_write;
--> statement-breakpoint
GRANT SELECT, INSERT ON learning_restricted.contributors, learning_restricted.audit_log TO surveynt_learning_write;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON learning_restricted.candidates TO surveynt_learning_write;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON learning_restricted.sanitisation_runs, learning_restricted.reviews TO surveynt_learning_write;
--> statement-breakpoint
CREATE TRIGGER learning_audit_log_immutable
  BEFORE UPDATE OR DELETE ON learning_restricted.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_mutation();
--> statement-breakpoint
-- Sanitisation results and review decisions are append-only; withdrawal erases them (app.erasure) and keeps only the audit record.
CREATE TRIGGER learning_sanitisation_runs_append_only
  BEFORE UPDATE OR DELETE ON learning_restricted.sanitisation_runs
  FOR EACH ROW EXECUTE FUNCTION public.protect_append_only_erasable();
--> statement-breakpoint
CREATE TRIGGER learning_reviews_append_only
  BEFORE UPDATE OR DELETE ON learning_restricted.reviews
  FOR EACH ROW EXECUTE FUNCTION public.protect_append_only_erasable();
--> statement-breakpoint
-- Candidate lineage never changes. Withdrawal is terminal and clears the copied content.
CREATE OR REPLACE FUNCTION learning_restricted.protect_candidates() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'candidates are kept as withdrawal lineage; withdraw instead'; END IF;
  IF OLD.status = 'withdrawn' THEN RAISE EXCEPTION 'withdrawn candidates cannot change'; END IF;
  IF (NEW.organisation_id, NEW.contributor_key, NEW.job_id, NEW.survey_id, NEW.element_id, NEW.element_ref, NEW.scope, NEW.grant_id, NEW.policy_version, NEW.source_fingerprint, NEW.dedup_key, NEW.group_key, NEW.created_at)
    IS DISTINCT FROM (OLD.organisation_id, OLD.contributor_key, OLD.job_id, OLD.survey_id, OLD.element_id, OLD.element_ref, OLD.scope, OLD.grant_id, OLD.policy_version, OLD.source_fingerprint, OLD.dedup_key, OLD.group_key, OLD.created_at) THEN
    RAISE EXCEPTION 'candidate lineage is immutable';
  END IF;
  IF NEW.content IS DISTINCT FROM OLD.content AND NOT (NEW.status = 'withdrawn' AND NEW.content = '{}'::jsonb) THEN
    RAISE EXCEPTION 'candidate content is immutable except when cleared on withdrawal';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_candidates_protected
  BEFORE UPDATE OR DELETE ON learning_restricted.candidates
  FOR EACH ROW EXECUTE FUNCTION learning_restricted.protect_candidates();
--> statement-breakpoint
-- The firm dashboard sees its own contribution counts, never the rows. Runs as
-- the owner, scoped to the caller's organisation context; returns nothing without it.
CREATE OR REPLACE FUNCTION public.learning_contribution_summary()
RETURNS TABLE (scope text, status text, cases integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.scope, c.status, count(*)::integer
  FROM learning_restricted.candidates c
  WHERE c.organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid
  GROUP BY c.scope, c.status
$$;
