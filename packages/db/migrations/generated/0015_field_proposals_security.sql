ALTER TABLE field_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE field_proposals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY field_proposals_tenant_isolation ON field_proposals FOR ALL
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
-- A proposal's content and provenance never change after creation; only the
-- review outcome may be recorded, and only once.
CREATE OR REPLACE FUNCTION protect_field_proposals() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.erasure', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'field proposals are retained for audit and evaluation';
  END IF;
  IF OLD.review_status <> 'pending' THEN
    RAISE EXCEPTION 'a reviewed proposal cannot be changed';
  END IF;
  IF (to_jsonb(NEW) - 'review_status' - 'reviewed_at' - 'reviewed_by_user_id' - 'review_note' - 'accepted_value_id')
     <> (to_jsonb(OLD) - 'review_status' - 'reviewed_at' - 'reviewed_by_user_id' - 'review_note' - 'accepted_value_id') THEN
    RAISE EXCEPTION 'proposal content and provenance are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER field_proposals_review_only
  BEFORE UPDATE OR DELETE ON field_proposals
  FOR EACH ROW EXECUTE FUNCTION protect_field_proposals();
