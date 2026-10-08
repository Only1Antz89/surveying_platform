CREATE OR REPLACE FUNCTION guard_media_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  FOR candidate IN
   SELECT DISTINCT j.organisation_id,j.id FROM public.jobs j WHERE j.organisation_id=(binding->>'organisation_id')::uuid AND (
    EXISTS (SELECT 1 FROM public.surveys s WHERE s.organisation_id=j.organisation_id AND s.job_id=j.id AND s.id=(binding->>'survey_id')::uuid)
    OR EXISTS (SELECT 1 FROM public.survey_file_removals r, jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=j.organisation_id AND r.job_id=j.id AND obj->>'kind'='media' AND obj->>'id' IN (binding->>'id',binding->>'derived_from_id',binding->>'media_id'))
   ) ORDER BY j.organisation_id,j.id
  LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.id AND r.status IN ('dispatched','verification_required','completed'))
   THEN
    IF TG_TABLE_NAME='media_analyses' AND TG_OP='UPDATE'
     AND to_jsonb(NEW)->'result'='{"retentionRemoved":true}'::jsonb
     AND (to_jsonb(NEW)-'result')=(to_jsonb(OLD)-'result')
    AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=candidate.organisation_id AND h.job_id=candidate.id AND h.kind IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=candidate.organisation_id AND d.legal_hold AND (d.job_id=candidate.id OR d.report_version_id IN (SELECT v.id FROM public.report_versions v WHERE v.organisation_id=candidate.organisation_id AND v.job_id=candidate.id)
      OR d.id IN (SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=candidate.organisation_id AND delivery.job_id=candidate.id)
      OR EXISTS(SELECT 1 FROM public.survey_file_removals held_removal, jsonb_array_elements(held_removal.manifest->'objects') held_object WHERE held_removal.organisation_id=candidate.organisation_id AND held_removal.job_id=candidate.id AND held_object->>'kind'='document' AND held_object->>'id'=d.id::text)))
     AND EXISTS(SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.id AND r.status='completed'
       AND r.progress->('media:'||(to_jsonb(OLD)->>'media_id'))->>'state'='removed'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.manifest->'objects') obj WHERE obj->>'kind'='media' AND obj->>'id'=to_jsonb(OLD)->>'media_id')
       AND EXISTS(SELECT 1 FROM public.audit_events e WHERE e.organisation_id=candidate.organisation_id AND e.resource_id=to_jsonb(OLD)->>'id' AND e.action='job.media_analysis_disposed' AND e.metadata->>'removalId'=r.id::text AND e.metadata->>'mediaId'=to_jsonb(OLD)->>'media_id'))
    THEN CONTINUE; END IF;
    RAISE EXCEPTION 'Media belonging to a file under removal cannot be changed or extended';
   END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION protect_media_analysis_disposition() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('app.erasure',true)='on' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND NEW.result='{"retentionRemoved":true}'::jsonb AND (to_jsonb(NEW)-'result')=(to_jsonb(OLD)-'result')
  AND EXISTS(SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=OLD.organisation_id AND r.status='completed' AND r.progress->('media:'||OLD.media_id::text)->>'state'='removed'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.manifest->'objects') obj WHERE obj->>'kind'='media' AND obj->>'id'=OLD.media_id::text)
   AND EXISTS(SELECT 1 FROM public.audit_events e WHERE e.organisation_id=OLD.organisation_id AND e.resource_id=OLD.id::text AND e.action='job.media_analysis_disposed' AND e.metadata->>'removalId'=r.id::text AND e.metadata->>'mediaId'=OLD.media_id::text))
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION '% rows are append-only',TG_TABLE_NAME;
END $$;
DROP TRIGGER media_analyses_append_only ON media_analyses;
CREATE TRIGGER media_analyses_append_only BEFORE UPDATE OR DELETE ON media_analyses FOR EACH ROW EXECUTE FUNCTION protect_media_analysis_disposition();
