-- Restricted release records: the learning service writes them; nobody else can read them.
GRANT SELECT, INSERT, UPDATE ON learning_restricted.releases, learning_restricted.release_items TO surveynt_learning_write;
--> statement-breakpoint
-- A release's content is fixed once it leaves draft; afterwards only its status and activation can change.
CREATE OR REPLACE FUNCTION learning_restricted.protect_releases() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'releases are kept as lineage; retire instead';
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'status' - 'activated_by_staff_id' - 'activated_at' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'activated_by_staff_id' - 'activated_at' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'approved releases are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_releases_protected
  BEFORE UPDATE OR DELETE ON learning_restricted.releases
  FOR EACH ROW EXECUTE FUNCTION learning_restricted.protect_releases();
--> statement-breakpoint
-- Release items only change status (withdrawal or retraction); they are never deleted once the release left draft.
CREATE OR REPLACE FUNCTION learning_restricted.protect_release_items() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'release items are kept as lineage'; END IF;
  IF (NEW.release_id, NEW.candidate_id, NEW.shared_case_id, NEW.weight) IS DISTINCT FROM (OLD.release_id, OLD.candidate_id, OLD.shared_case_id, OLD.weight) THEN
    RAISE EXCEPTION 'release item lineage is immutable';
  END IF;
  IF OLD.status <> 'included' THEN RAISE EXCEPTION 'withdrawn or retracted items cannot change'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_release_items_protected
  BEFORE UPDATE OR DELETE ON learning_restricted.release_items
  FOR EACH ROW EXECUTE FUNCTION learning_restricted.protect_release_items();
--> statement-breakpoint
-- Shared knowledge: the learning service publishes; the tenant role (via surveynt_learning_read) reads.
REVOKE ALL ON SCHEMA learning_shared FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA learning_shared TO surveynt_learning_read, surveynt_learning_write;
--> statement-breakpoint
GRANT SELECT ON learning_shared.releases, learning_shared.cases TO surveynt_learning_read;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_shared.releases, learning_shared.cases TO surveynt_learning_write;
--> statement-breakpoint
-- Readers see only the active release; the service sees everything it manages.
ALTER TABLE learning_shared.releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE learning_shared.cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shared_releases_read ON learning_shared.releases FOR SELECT TO surveynt_learning_read USING (status = 'active');
--> statement-breakpoint
CREATE POLICY shared_releases_service ON learning_shared.releases FOR ALL TO surveynt_learning_write USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY shared_cases_read ON learning_shared.cases FOR SELECT TO surveynt_learning_read
  USING (EXISTS (SELECT 1 FROM learning_shared.releases r WHERE r.id = release_id AND r.status = 'active'));
--> statement-breakpoint
CREATE POLICY shared_cases_service ON learning_shared.cases FOR ALL TO surveynt_learning_write USING (true) WITH CHECK (true);
--> statement-breakpoint
-- A released case is never edited: a correction is a retraction plus a new review and release.
CREATE TRIGGER shared_cases_no_update
  BEFORE UPDATE ON learning_shared.cases
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_mutation();
--> statement-breakpoint
CREATE UNIQUE INDEX shared_releases_one_active_uidx ON learning_shared.releases ((status)) WHERE status = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX learning_releases_one_active_uidx ON learning_restricted.releases ((status)) WHERE status = 'active';
