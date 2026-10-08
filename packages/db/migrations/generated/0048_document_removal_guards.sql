ALTER TABLE organisation_documents ADD CONSTRAINT document_removal_archived_chk CHECK (purge_status='retained' OR deleted_at IS NOT NULL);
ALTER TABLE organisation_documents ADD CONSTRAINT document_removed_timestamp_chk CHECK ((purge_status='purged') = (purged_at IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION document_removal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.purge_status<>'retained' THEN RAISE EXCEPTION 'Removal evidence must be retained'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.purge_status<>'retained' AND
  ROW(NEW.id,NEW.organisation_id,NEW.blob_pathname,NEW.blob_url,NEW.checksum,NEW.size_bytes,NEW.content_type,NEW.job_id,NEW.report_version_id,NEW.deleted_at,NEW.legal_hold,NEW.retention_until,NEW.name,NEW.category,NEW.access_class)
  IS DISTINCT FROM
  ROW(OLD.id,OLD.organisation_id,OLD.blob_pathname,OLD.blob_url,OLD.checksum,OLD.size_bytes,OLD.content_type,OLD.job_id,OLD.report_version_id,OLD.deleted_at,OLD.legal_hold,OLD.retention_until,OLD.name,OLD.category,OLD.access_class)
 THEN RAISE EXCEPTION 'An original under removal cannot be restored or changed'; END IF;
 IF OLD.purge_status='purged' AND NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN RAISE EXCEPTION 'Removal completion evidence is immutable'; END IF;
 IF NEW.purge_status<>OLD.purge_status AND NOT (
  (OLD.purge_status='retained' AND NEW.purge_status='pending') OR
  (OLD.purge_status='pending' AND NEW.purge_status IN ('retained','removing','verification_required')) OR
  (OLD.purge_status='removing' AND NEW.purge_status IN ('verification_required','purged')) OR
  (OLD.purge_status='verification_required' AND NEW.purge_status IN ('retained','purged'))
 ) THEN RAISE EXCEPTION 'Invalid original removal transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_removal_guard BEFORE UPDATE OR DELETE ON organisation_documents FOR EACH ROW EXECUTE FUNCTION document_removal_guard();
