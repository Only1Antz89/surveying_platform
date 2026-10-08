CREATE FUNCTION guard_report_document_reference() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE original public.organisation_documents%ROWTYPE;
BEGIN
 IF NEW.document_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO original FROM public.organisation_documents WHERE id=NEW.document_id FOR UPDATE;
 IF NOT FOUND OR original.organisation_id<>NEW.organisation_id OR original.purge_status<>'retained'
 OR (original.job_id IS NOT NULL AND original.job_id<>NEW.job_id)
 OR (original.report_version_id IS NOT NULL AND original.report_version_id<>NEW.report_version_id)
 THEN RAISE EXCEPTION 'Report original binding is unavailable or inconsistent'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id=NEW.job_id AND organisation_id=NEW.organisation_id)
 THEN RAISE EXCEPTION 'Report job belongs to another practice'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_document_reference_guard BEFORE INSERT OR UPDATE ON report_deliveries FOR EACH ROW EXECUTE FUNCTION guard_report_document_reference();
--> statement-breakpoint
CREATE FUNCTION guard_referenced_document_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.purge_status IN ('pending','removing','purged') AND EXISTS (SELECT 1 FROM public.report_deliveries WHERE document_id=NEW.id)
 THEN RAISE EXCEPTION 'Report delivery evidence requires its retention workflow'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referenced_document_removal_guard BEFORE INSERT OR UPDATE ON organisation_documents FOR EACH ROW EXECUTE FUNCTION guard_referenced_document_removal();
